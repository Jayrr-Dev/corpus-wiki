import type { DraftAction, DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { recordUpload, reconcileUpload, type PipelineDeps } from "@/lib/ingest/pipeline";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { runModuleUpkeep } from "@/lib/processing/moduleUpkeep";
import { FakeSectionWriter, type SectionWriter } from "@/lib/living-page";
import type { portablePostgres } from "./portablePostgres";

type Store = Awaited<ReturnType<typeof portablePostgres>>;

// A GENERATED UPLOAD through the real pipeline: `entities` groups of `claimsEach` claims,
// one page of three sections per group. Extraction and section prose are deterministic, no AI calls.
export async function uploadFixture(store: Store, name: string, entities: number, claimsEach: number) {
  const rows = Array.from({ length: entities }, (_, entity) => Array.from({ length: claimsEach }, (_, claim) => ({
    name: `Fixture ${name} group ${String(entity).padStart(2, "0")}`, key: `fixture-${name}-${entity}`,
    kind: (["decision", "fact", "procedure"] as const)[claim % 3]!,
    text: `Fixture ${name} group ${String(entity).padStart(2, "0")} records requirement ${claim}, at location ${entity}.`,
  }))).flat();
  const draftChangeSet = async (input: ReconciliationInput): Promise<DraftChangeSet> => {
    const actions: DraftAction[] = [];
    for (const row of rows.filter((_row, index) => index % claimsEach === 0)) actions.push({ type: "create_entity", targetId: null, expectedRevisionId: null,
      passageIds: [], speechAct: null, input: { type: "team", key: row.key, name: row.name, aliases: [] } });
    for (const row of rows) {
      const passage = input.passages.find((value) => value.text === row.text);
      if (!passage) throw new Error("Generated claim has no matching source passage");
      actions.push({ type: "add_claim", targetId: null, expectedRevisionId: null, passageIds: [passage.id], speechAct: "stated",
        input: { content: row.text, kind: row.kind, epistemicStatus: "supported", validFrom: input.source.sourceDate,
          entities: [{ type: "team", key: row.key, role: "subject" }], domainPaths: [] } });
    }
    return { summary: `Fixture ${name}`, actions, trace: { modelVersion: "synthetic", promptVersion: "synthetic-v1", tokensIn: 0, tokensOut: 0 } };
  };
  const fake = new FakeSectionWriter();
  const writer: SectionWriter = { name: "synthetic", reviseSection: (input) => fake.reviseSection(input), async reviewSections() {} };
  const deps: PipelineDeps = { db: store.db, reconciler: { name: "synthetic", draftChangeSet }, writer };
  const started = await recordUpload(store.db, { title: `Fixture ${name}`, mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z",
    hash: `fixture:${name}`, storagePath: `fixture/${name}.txt`, passages: splitIntoPassages([{ page: null, text: rows.map((row) => row.text).join("\n\n") }]) });
  if (started.kind !== "started") throw new Error("Expected a new fixture source");
  // The upload saves the knowledge; the Wiki and the other modules then write from it
  const run = async () => {
    const result = await reconcileUpload(deps, started.eventId);
    await runModuleUpkeep(deps, 600_000);
    return result;
  };
  return { eventId: started.eventId, claims: rows.length, result: await run(), run };
}

// HOW MUCH CHANGE CONTROL ONE UPLOAD WROTE: its change sets and their actions
export async function uploadChangeCounts(store: Store, eventId: string) {
  return (await store.pg.query<{ sets: number; actions: number }>(`select count(distinct c.id)::int sets, count(a.id)::int actions
    from public.change_sets c left join public.actions a on a.change_set_id=c.id where c.event_id=$1`, [eventId])).rows[0]!;
}
