import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store?.pg.close(); });

it("keeps applied, reverted, duplicate and composite targets without treating other payload fields as targets", async () => {
  const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
  const create = (actions: unknown[]) => store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
    p_event_id: null, p_cause: "edit", p_actor: "ai", p_summary: "Event target fixture", p_trace: {}, p_actions: actions,
  });
  const action = (type: string, targetId: string | null, input: unknown) => ({ type, targetId, passageIds: [], input });
  const event = await create([
    action("add_claim", ids[0]!, { content: "Evidence ".repeat(100_000), toUnitId: ids[11] }),
    action("merge_duplicates", ids[1]!, { duplicateUnitIds: [ids[2], ids[0]] }),
    action("link", ids[3]!, { type: "part_of", toUnitId: ids[4] }),
    action("link", ids[5]!, { type: "supports", toUnitId: ids[11] }),
    action("set_member", ids[6]!, { memberUnitId: ids[7] }),
    action("add_claim", ids[8]!, { content: "Pending" }),
    action("merge_duplicates", null, { duplicateUnitIds: null }),
  ]);
  await store.pg.query("update actions set outcome='applied' where change_set_id=$1 and position<>5", [event.changeSetId]);
  const old = await create([action("merge_duplicates", ids[9]!, { duplicateUnitIds: [ids[10]] })]);
  await store.pg.query("update actions set outcome='reverted',reverted_by_event_id=$1 where change_set_id=$2", [event.eventId, old.changeSetId]);
  const unrelated = await create([action("add_claim", ids[11]!, { content: "Unrelated" })]);
  await store.pg.query("update actions set outcome='applied' where change_set_id=$1", [unrelated.changeSetId]);
  const result = await store.pg.query<{ id: string }>("select public.living_page_event_units($1) id", [event.eventId]);
  expect(result.rows.map(row => row.id).sort()).toEqual(ids.filter((_, index) => index !== 8 && index !== 11).sort());
});
