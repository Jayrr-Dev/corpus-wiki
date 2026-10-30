import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Re-embeds claims after the claim embedding text changes (#39, lib/knowledge/claimEmbeddingText.ts).
//   default   embeds every live claim whose vector is missing or of an older text version.
//             Pages of 256, requests of 64, 2 at a time; safe to stop and run again (it only
//             asks for what is still missing) and it holds no locks, so uploads keep running.
//   --pairs   reads only (no AI calls): counts duplicate-candidate pairs from saved vectors.
//             Run it before and after the re-embed and compare:
//               cross-entity same wording  pairs with the same words but other subjects or scope;
//                                          at or above the candidate line they crowd similar_units
//               same-context candidates    pairs that may merge; these should still be found
// node --experimental-strip-types --env-file=.env.local scripts/reembed-claims.ts [--pairs]
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { embedderFromEnv, DEFAULT_EMBEDDING_MODEL } = await runtime.ssrLoadModule("/lib/ai/embeddings.ts");
  const { embedMissingUnits, savedVectors } = await runtime.ssrLoadModule("/lib/knowledge/embeddingStore.ts");
  const { CLAIM_TEXT_VERSION } = await runtime.ssrLoadModule("/lib/knowledge/claimEmbeddingText.ts");
  const { contextsCompatibleForMerge, parseKnowledgeContext } = await runtime.ssrLoadModule("/lib/knowledge/context.ts");
  const { CANDIDATE_COSINE, cosine, normalizeClaim } = await runtime.ssrLoadModule("/lib/knowledge/similarity.ts");

  const client = getAdminSupabase();
  const db = supabaseRpc(client);

  if (!process.argv.includes("--pairs")) {
    const embedder = embedderFromEnv(process.env, (call: unknown) => db.call("log_ai_call", { p_call: call }));
    if (!embedder) throw new Error("Set NEBIUS_API_KEY in .env.local first.");
    const started = Date.now();
    console.log(`Embedded ${await embedMissingUnits(db, embedder)} claims as text version ${CLAIM_TEXT_VERSION} in ${Math.round((Date.now() - started) / 1000)} seconds.`);
  } else {
    // LIVE CLAIMS with their context and saved vector
    type Context = { entities: { role: string }[]; applicability: unknown };
    type Claim = { revisionId: string; text: string; context: Context | null; version: number; vector?: number[] };
    const claims: Claim[] = [];
    for (let start = 0; ; start += 1000) {
      const page = await client.from("units").select("current_revision_id").is("retired_at", null).order("id").range(start, start + 999);
      if (page.error) throw page.error;
      for (let at = 0; at < page.data.length; at += 200) {
        const ids = page.data.slice(at, at + 200).map((unit: { current_revision_id: string }) => unit.current_revision_id);
        const revisions = await client.from("revisions").select("id, content, knowledge_context").in("id", ids);
        if (revisions.error) throw revisions.error;
        const versions = await client.from("unit_embeddings").select("revision_id, text_version").in("revision_id", ids);
        if (versions.error) throw versions.error;
        const versionOf = new Map<string, number>(versions.data.map((row: { revision_id: string; text_version: number }) => [row.revision_id, row.text_version]));
        for (const revision of revisions.data) claims.push({ revisionId: revision.id, text: normalizeClaim(revision.content), context: parseKnowledgeContext(revision.knowledge_context), version: versionOf.get(revision.id) ?? -1 });
      }
      if (page.data.length < 1000) break;
    }
    const model = process.env.AI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    for (let at = 0; at < claims.length; at += 256) {
      const vectors: Map<string, number[]> = await savedVectors(db, model, claims.slice(at, at + 256).map((claim) => claim.revisionId));
      for (const claim of claims.slice(at, at + 256)) claim.vector = vectors.get(claim.revisionId);
    }

    // PAIRS: same wording across contexts, and every pair within a mergeable context
    const crossEntity = { pairs: 0, aboveLine: 0 };
    const sameContext = { pairs: 0, aboveLine: 0 };
    const byText = new Map<string, Claim[]>();
    for (const claim of claims) if (claim.text) byText.set(claim.text, [...(byText.get(claim.text) ?? []), claim]);
    for (const group of byText.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const [a, b] = [group[i]!, group[j]!];
      if (contextsCompatibleForMerge(a.context, b.context) || !a.vector || !b.vector) continue;
      crossEntity.pairs++;
      if (cosine(a.vector, b.vector) >= CANDIDATE_COSINE) crossEntity.aboveLine++;
    }
    const byContext = new Map<string, Claim[]>();
    for (const claim of claims) if (claim.vector && claim.context) {
      // What merging compares (lib/knowledge/context.ts): scope and the entities that are not only mentioned
      const key = JSON.stringify([claim.context.applicability, claim.context.entities.filter((entity) => entity.role !== "mentioned")]);
      byContext.set(key, [...(byContext.get(key) ?? []), claim]);
    }
    for (const group of byContext.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const [a, b] = [group[i]!, group[j]!];
      if (a.text === b.text || !contextsCompatibleForMerge(a.context, b.context)) continue;
      sameContext.pairs++;
      if (cosine(a.vector!, b.vector!) >= CANDIDATE_COSINE) sameContext.aboveLine++;
    }
    const versions = new Map<number, number>();
    for (const claim of claims) versions.set(claim.version, (versions.get(claim.version) ?? 0) + 1);
    console.log(`${claims.length} live claims; text versions: ${[...versions].sort((a, b) => a[0] - b[0]).map(([version, count]) => `${version === -1 ? "none" : version} ${count}`).join(", ")}.`);
    console.log(`Cross-entity same wording: ${crossEntity.pairs} pairs, ${crossEntity.aboveLine} at or above cosine ${CANDIDATE_COSINE}.`);
    console.log(`Same-context candidates (other wording): ${sameContext.aboveLine} of ${sameContext.pairs} pairs at or above cosine ${CANDIDATE_COSINE}.`);
  }
} finally {
  await runtime.close();
}
