import { targetFromEnvironment } from "./targets.ts";
import { quoteLiteral } from "./migrate.ts";
import { duplicateSectionRepairs, type PageReviewSnapshot } from "../../lib/living-page/pageReview.ts";

const db = await targetFromEnvironment(process.env);
const slug = process.argv[2];
if (!slug) throw new Error("Pass the page slug to repair.");
try {
  const [row] = await db.query<{ snapshot: PageReviewSnapshot }>(`select public.page_review_snapshot(id) snapshot from public.pages where slug=${quoteLiteral(slug)} and retired_at is null`);
  if (!row) throw new Error("Page unavailable");
  const snapshot = row.snapshot;
  const edits = duplicateSectionRepairs(snapshot);
  if (!edits.length) { console.log("No equivalent duplicate sections found."); }
  else {
    const report = { summary: `Consolidated ${edits.length} duplicate section(s) into the introduction, preserving the full text and citations.`, findings: [] };
    const call = `select public.complete_page_review(${quoteLiteral(snapshot.page.id)}::uuid,${quoteLiteral(JSON.stringify(snapshot))}::jsonb,${quoteLiteral(JSON.stringify(report))}::jsonb,${quoteLiteral(JSON.stringify(edits))}::jsonb,'{"modelVersion":"deterministic-editor","promptVersion":"page-review-v2"}') result`;
    // Exercise apply and undo in one rollback-only transaction first.
    await db.query(`begin; do $test$ declare r jsonb; begin
      ${call.replace("select ", "select ").replace(" result", " into r")};
      if (r->>'edits')::integer<>${edits.length} then raise exception 'Expected duplicate repairs'; end if;
      if public.pages_needing_editorial_review(array[${edits.map((edit) => quoteLiteral(edit.targetId) + "::uuid").join(",")}])<>'[]'::jsonb then raise exception 'Unchanged page would be reviewed again'; end if;
      perform public.revert_change_set((r->>'changeSetId')::uuid);
      if public.page_review_snapshot(${quoteLiteral(snapshot.page.id)}::uuid) is distinct from ${quoteLiteral(JSON.stringify(snapshot))}::jsonb then raise exception 'Undo failed to restore the page'; end if;
    end $test$; rollback;`);
    console.log("Automatic repair and exact undo verified.");
    console.log(JSON.stringify(await db.query(call)));
  }
} finally { await db.close(); }
