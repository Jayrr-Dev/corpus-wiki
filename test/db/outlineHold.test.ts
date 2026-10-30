import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("holds one outline recommendation per article in Exceptions, which accepting only records", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Held outline','held-outline') returning id")).rows[0]!.id;
    const hold = () => db.call<{ exceptions: number; changeSetId: string | null }>("record_outline_hold", { p_page_id: page,
      p_finding: { recommendation: "Review this article's structure.", reason: "C3 belongs with Details.", guideline: "Move C3." }, p_trace: { modelVersion: "test" } });
    const first = await hold();
    expect(first.exceptions).toBe(1);
    expect(await hold()).toEqual({ exceptions: 0, changeSetId: null });
    const held = (await pg.query<{ id: string; reason: string; type: string; source: string; role: string }>(`select e.id,e.reason,a.type,a.input->>'source' source,c.actor_attribution->'proposedBy'->>'role' role
      from exceptions e join actions a on a.id=e.action_id join change_sets c on c.id=a.change_set_id where a.target_id=$1`, [page])).rows;
    expect(held).toMatchObject([{ reason: "domain_tree_review", type: "review_page", source: "outline_review", role: "reviewer" }]);
    await db.call("resolve_exception", { p_exception_id: held[0]!.id, p_accept: true, p_note: null });
    expect((await pg.query("select title from pages where id=$1", [page])).rows[0]).toEqual({ title: "Held outline" });
    // Once answered, a later rejection may raise a new recommendation.
    expect((await hold()).exceptions).toBe(1);
  } finally { await pg.close(); }
});
