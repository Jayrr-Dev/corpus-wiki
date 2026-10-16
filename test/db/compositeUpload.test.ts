import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import type { ReconciliationAnswer } from "@/lib/ai/tokenFactory/schema";
import { answerToActions } from "@/lib/ai/tokenFactory/toDraft";
import { reconcileUpload, recordUpload } from "@/lib/ingest/pipeline";
import { getSectionWriter } from "@/lib/living-page";

// A procedure file through the real upload pipeline and Change control, with a stand-in model
describe("uploading a procedure", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const STEPS = ["Ladderco checks the rungs.", "Ladderco checks the feet.", "Ladderco tags a failed ladder."];
  const base = { unit: null, title: "", epistemicStatus: "established" as const, speechAct: "stated" as const, entities: [{ type: "company" as const, key: "ladderco", name: "Ladderco", role: "subject" as const }], domainPaths: [], reason: "" };

  // First file: the procedure and its steps. Second file: the same steps, the last two swapped.
  const answers: Record<string, (input: ReconciliationInput) => ReconciliationAnswer> = {
    "ladders-v1.md": () => ({ summary: "Ladder inspection", claims: [
      { ...base, action: "add", kind: "procedure", content: "Ladderco inspects a ladder in three steps.", passages: ["P1"], structure: { type: "sequence", complete: true, mode: null } },
      ...STEPS.map((content, index) => ({ ...base, action: "add" as const, kind: "procedure" as const, content, passages: [`P${index + 2}`] })),
    ], links: STEPS.map((_, index) => ({ from: `C${index + 2}`, to: "C1", type: "part_of" as const, position: index + 1, reason: "" })) }),
    "ladders-v2.md": (input) => {
      const ref = (content: string) => `U${input.existingUnits.findIndex((unit) => unit.content === content) + 1}`;
      const order = [STEPS[0]!, STEPS[2]!, STEPS[1]!];
      return { summary: "Tag before checking the feet", claims: order.map((content, index) => ({ ...base, action: "revise" as const, unit: ref(content), kind: "procedure" as const, content, passages: [`P${index + 1}`] })),
        links: order.map((content, index) => ({ from: `C${index + 1}`, to: ref("Ladderco inspects a ladder in three steps."), type: "part_of" as const, position: index + 1, reason: "" })) };
    },
  };
  const reconciler: ReconciliationClient = {
    name: "stand-in",
    async draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet> {
      const answer = answers[input.source.title]!(input);
      return { summary: answer.summary, actions: answerToActions(answer, input), trace: { modelVersion: "stand-in", promptVersion: null, tokensIn: 0, tokensOut: 0 } };
    },
  };
  async function upload(title: string, lines: string[]) {
    const started = await recordUpload(store.db, {
      title, mimeType: "text/markdown", sourceDate: "2026-11-09T00:00:00Z", hash: title, storagePath: `test/${title}`,
      passages: lines.map((text, position) => ({ position, text, location: {}, hash: `${title}-${position}`, speakerLabel: null })),
    });
    if (started.kind !== "started") throw new Error("The upload was skipped");
    return reconcileUpload({ db: store.db, reconciler, writer: getSectionWriter({ NODE_ENV: "test" }) }, started.eventId, "knowledge");
  }
  const order = async () => (await store.pg.query<{ content: string; position: number }>(
    `select r.content, l.position from relationships l join units c on c.id = l.to_unit_id join revisions cr on cr.id = c.current_revision_id
     join units m on m.id = l.from_unit_id join revisions r on r.id = m.current_revision_id
     where cr.structure is not null and l.type = 'part_of' and l.retired_at is null order by l.position`)).rows;

  it("saves the procedure with its steps in order, then follows a reordering", async () => {
    const first = await upload("ladders-v1.md", ["Inspect every ladder:", "1. Check the rungs.", "2. Check the feet.", "3. Tag a failed ladder."]);
    expect(first.error).toBeNull();
    expect(await order()).toEqual(STEPS.map((content, index) => ({ content, position: index + 1 })));

    const second = await upload("ladders-v2.md", ["1. Check the rungs.", "2. Tag a failed ladder.", "3. Check the feet."]);
    expect(second.error).toBeNull();
    expect((await order()).map((row) => row.content)).toEqual([STEPS[0], STEPS[2], STEPS[1]]);
    const moves = await store.pg.query("select 1 from actions where type = 'set_member' and outcome = 'applied'");
    expect(moves.rows).toHaveLength(2);
  });
});
