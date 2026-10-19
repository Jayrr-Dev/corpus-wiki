import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { TabLayout, TabPlan } from "@/lib/domains/tabOrganization";

let fixture: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { fixture = await portablePostgres(); });
afterAll(async () => { await fixture?.pg.close(); });
const current = () => fixture.db.call<TabLayout>("domain_tab_layout");
const proposal = (layout: TabLayout): TabPlan => ({ reason: "Group knowledge by subject", tabs: layout.tabs.map(t => ({ id: t.id, name: t.name, description: t.description, rootIds: layout.roots.filter(r => t.root_ids.includes(r.id)).map(r => r.id) })) });

it("atomically creates a navigation tab while preserving domain identity and provenance", async () => {
  const layout = await current();
  const root = layout.roots[0]!;
  const before = await fixture.pg.query("select * from domains order by id");
  const plan = proposal(layout);
  plan.tabs.forEach(t => { t.rootIds = t.rootIds.filter(id => id !== root.id); });
  plan.tabs.push({ id: null, name: "Subject collection", description: "Related saved subjects", rootIds: [root.id] });
  await fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: plan });
  expect((await current()).tabs.find(t => t.name === "Subject collection")?.root_ids).toEqual([root.id]);
  expect((await fixture.pg.query("select * from domains order by id")).rows).toEqual(before.rows);
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: plan })).rejects.toThrow("changed");
});

it("rolls back all changes for duplicate memberships and invalid later tabs", async () => {
  const layout = await current();
  const invalid = proposal(layout);
  invalid.tabs.push({ id: null, name: "Duplicate membership", description: "Invalid", rootIds: [layout.roots[0]!.id] });
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: invalid })).rejects.toThrow("exactly once");
  expect(await current()).toEqual(layout);
  const lateFailure = proposal(layout);
  const first = lateFailure.tabs.find(t => t.rootIds.length)!;
  const moved = first.rootIds.pop()!;
  lateFailure.tabs.push({ id: null, name: "New first", description: "Valid new tab", rootIds: [moved] });
  // A new tab cannot silently replace an existing tab even if the first entry was valid.
  lateFailure.tabs.push({ id: null, name: layout.tabs[0]!.name, description: "Collision", rootIds: [] });
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: lateFailure })).rejects.toThrow();
  expect(await current()).toEqual(layout);
});

it("does not allow unknown roots, omitted tabs or misleading existing-tab renames", async () => {
  const layout = await current();
  const foreign = proposal(layout);
  foreign.tabs[0]!.rootIds.push("10000000-0000-4000-8000-000000000099");
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: foreign })).rejects.toThrow("exactly once");
  const omitted = proposal(layout); omitted.tabs.shift();
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: omitted })).rejects.toThrow("Keep all");
  const renamed = proposal(layout); renamed.tabs[0]!.name = "Internal policies";
  await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: layout, p_plan: renamed })).rejects.toThrow("unchanged");
  expect(await current()).toEqual(layout);
});

it("keeps the new RPCs inside the selected space under the non-bypass runtime role", async () => {
  const owner = "10000000-0000-4000-8000-000000000011";
  await fixture.pg.query("insert into auth.users(id,email) values($1,'tabs-owner@example.test')", [owner]);
  await fixture.pg.exec("begin");
  try {
    await fixture.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.headers',$2,true)", [JSON.stringify({ role: "service_role" }), JSON.stringify({ "x-person-id": owner })]);
    const space = await fixture.db.call<{ id: string }>("create_space", { p_name: "Tab isolation" });
    await fixture.pg.query("select set_config('request.headers',$1,true)", [JSON.stringify({ "x-person-id": owner, "x-space-id": space.id })]);
    await fixture.pg.exec("set local role space_runtime");
    const isolated = await current();
    expect(isolated.roots).toEqual([]);
    expect(isolated.tabs).toHaveLength(2);
    await fixture.db.call("apply_domain_tab_plan", { p_snapshot: isolated, p_plan: proposal(isolated) });
    expect(await current()).toEqual(isolated);
    const foreign = proposal(isolated);
    foreign.tabs[0]!.rootIds = ["10000000-0000-4000-8000-000000000099"];
    await expect(fixture.db.call("apply_domain_tab_plan", { p_snapshot: isolated, p_plan: foreign })).rejects.toThrow("exactly once");
  } finally { await fixture.pg.exec("rollback"); }
});
