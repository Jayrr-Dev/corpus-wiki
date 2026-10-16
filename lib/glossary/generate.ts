import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { Json, Tables } from "@/lib/database/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { dictionaryAnswerSchema, DICTIONARY_PROMPT, GLOSSARY_VERSION, mergeGlossaryEntries } from "./entries";
import { glossaryClient, type GlossaryState, type GlossaryUpdate } from "./storage";

type InputClaim = {
  id: string; revisionId: string; text: string; context: ReturnType<typeof parseKnowledgeContext>;
  sourceEvidence: { sourceId: string; sourceTitle: string; text: string }[];
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await read(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...data ?? []);
    if (!data || data.length < 500) return rows;
  }
}

async function currentClaims(client: AdminSupabase): Promise<InputClaim[]> {
  const units = await allRows((from, to) => client.from("units").select("id, current_revision_id").is("retired_at", null).order("id").range(from, to));
  const claims: InputClaim[] = [];
  for (let offset = 0; offset < units.length; offset += 50) {
    const part = units.slice(offset, offset + 50);
    const { data: revisions, error } = await client.from("revisions").select("id, unit_id, content, passage_ids, knowledge_context").in("id", part.map((unit) => unit.current_revision_id));
    if (error) throw new Error(error.message);
    const passageIds = [...new Set((revisions ?? []).flatMap((revision) => revision.passage_ids))];
    const passages: Pick<Tables<"passages">, "id" | "source_id" | "text">[] = [];
    for (let i = 0; i < passageIds.length; i += 80) {
      const result = await client.from("passages").select("id, source_id, text").in("id", passageIds.slice(i, i + 80));
      if (result.error) throw new Error(result.error.message);
      passages.push(...result.data ?? []);
    }
    const sourceIds = [...new Set(passages.map((passage) => passage.source_id))];
    const sources = sourceIds.length ? await client.from("sources").select("id, title").in("id", sourceIds) : { data: [], error: null };
    if (sources.error) throw new Error(sources.error.message);
    const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source.title]));
    const passageById = new Map(passages.map((passage) => [passage.id, passage]));
    const revisionById = new Map((revisions ?? []).map((revision) => [revision.id, revision]));
    for (const unit of part) {
      const revision = revisionById.get(unit.current_revision_id);
      if (!revision) throw new Error("Knowledge changed while reading it. Try again.");
      const sourceEvidence = revision.passage_ids.flatMap((id) => {
        const passage = passageById.get(id);
        return passage ? [{ sourceId: passage.source_id, sourceTitle: sourceById.get(passage.source_id) ?? "Source", text: passage.text }] : [];
      });
      if (sourceEvidence.length) claims.push({ id: unit.id, revisionId: revision.id, text: revision.content, context: parseKnowledgeContext(revision.knowledge_context), sourceEvidence });
    }
  }
  return claims;
}

// Stable, bounded batches keep prompts readable and let interrupted work reuse completed AI calls.
export function dictionaryBatches(claims: InputClaim[]): InputClaim[][] {
  const batches: InputClaim[][] = [];
  let current: InputClaim[] = [], size = 0;
  for (const claim of claims) {
    const length = JSON.stringify(claim).length;
    if (current.length && (current.length >= 28 || size + length > 55_000)) { batches.push(current); current = []; size = 0; }
    current.push(claim); size += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function generateGlossary(client: AdminSupabase, settings: TokenFactorySettings, force = false): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!await generateOnce(client, settings, force && attempt === 0)) return;
  }
  throw new Error("Knowledge is still changing. Retry the dictionary update when processing finishes.");
}

async function generateOnce(client: AdminSupabase, settings: TokenFactorySettings, force: boolean): Promise<boolean> {
  const storage = glossaryClient(client);
  const claims = await currentClaims(client);
  const inputHash = hash([GLOSSARY_VERSION, settings.model, claims]);
  const token = await supabaseRpc(client).call<string | null>("claim_glossary_generation", { p_hash: inputHash, p_force: force });
  if (!token) return false;
  const save = async (values: GlossaryUpdate) => {
    const result = await storage.from("glossary_state").update(values).eq("id", true).eq("lease_token", token).select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("Another glossary generation took over. Retry to see its result.");
  };
  try {
    const { data: state, error } = await storage.from("glossary_state").select("batches").eq("id", true).single();
    if (error) throw new Error(error.message);
    const cached = state.batches as unknown as GlossaryState["batches"];
    const batches = dictionaryBatches(claims);
    const completed: GlossaryState["batches"] = {};
    await save({ total_batches: batches.length });
    for (const [index, batch] of batches.entries()) {
      const batchHash = hash([GLOSSARY_VERSION, settings.model, batch]);
      if (!force && cached[batchHash]) completed[batchHash] = cached[batchHash];
      else {
        const refs = new Map(batch.map((claim, i) => [`K${i + 1}`, claim]));
        const result = await chatJson(settings, {
          name: "glossary_dictionary", subject: `Dictionary batch ${index + 1}/${batches.length}`,
          schema: dictionaryAnswerSchema, jsonSchema: z.toJSONSchema(dictionaryAnswerSchema), maxTokens: 10000,
          messages: [{ role: "system", content: DICTIONARY_PROMPT }, { role: "user", content: JSON.stringify({ knowledge: [...refs].map(([ref, claim]) => ({ ref, text: claim.text, context: claim.context, sourceEvidence: claim.sourceEvidence })) }) }],
        });
        completed[batchHash] = result.value.entries.map((entry) => {
          const cited = entry.citations.map((ref) => {
            const claim = refs.get(ref);
            if (!claim) throw new Error(`The dictionary returned an unknown citation: ${ref}`);
            return claim;
          });
          const scopes = [...new Map(cited.map((claim) => {
            const scope = claim.context?.applicability;
            return [JSON.stringify(scope ?? null), scope];
          })).values()];
          const scoped = scopes.filter((scope) => scope?.status === "scoped");
          return {
            ...entry,
            scopeKey: JSON.stringify(scopes.map((scope) => scope ?? null).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))),
            context: scoped.length ? scoped.map((scope) => [...scope!.entities.map((entity) => entity.key.replaceAll("-", " ")), scope!.conditions].filter(Boolean).join(" · ")).join("; ") : null,
            citations: [...new Map(cited.flatMap((claim) => claim.sourceEvidence.map((source) => ({ unitId: claim.id, revisionId: claim.revisionId, sourceId: source.sourceId, sourceTitle: source.sourceTitle }))).map((cite) => [`${cite.revisionId}:${cite.sourceId}`, cite])).values()],
          };
        });
      }
      await save({ batches: { ...cached, ...completed } as unknown as Json, completed_batches: index + 1, lease_until: new Date(Date.now() + 600_000).toISOString() });
    }
    // Never publish against superseded knowledge. A retry reuses every unchanged batch.
    const current = await currentClaims(client);
    if (hash([GLOSSARY_VERSION, settings.model, current]) !== inputHash) {
      await save({ status: "idle", lease_token: null, lease_until: null });
      return true;
    }
    await save({ entries: mergeGlossaryEntries(Object.values(completed).flat()) as unknown as Json, batches: completed as unknown as Json,
      input_hash: inputHash, generated_at: new Date().toISOString(), status: "ready", error: null, lease_token: null, lease_until: null });
    return false;
  } catch (error) {
    await save({ status: "error", error: error instanceof Error ? error.message : String(error), lease_token: null, lease_until: null });
    throw error;
  }
}
