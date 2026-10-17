import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); }, 60000);
afterAll(async () => { await store?.pg.close(); });

it("completes page reviews with and without edits without record/alias ambiguity", async () => {
  const line = (await store.pg.query<{ page_id: string; line_id: string; content: string }>(
    "select page_id,line_id,content from public.section_lines where author='ai' limit 1")).rows[0]!;
  expect(line).toBeTruthy();
  for (const edits of [[], [{ type: "revise_line", targetId: line.line_id, text: line.content, reason: "Regression check" }]]) {
    const snapshot = await store.db.call("page_review_snapshot", { p_page_id: line.page_id });
    const result = await store.db.call<{ edits: number }>("complete_page_review", {
      p_page_id: line.page_id, p_snapshot: snapshot,
      p_review: { summary: "Alias regression", findings: [], coverageComplete: true },
      p_edits: edits, p_trace: {},
    });
    expect(result.edits).toBe(edits.length);
  }
});
