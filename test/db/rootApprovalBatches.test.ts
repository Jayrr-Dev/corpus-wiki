import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });
beforeEach(async () => { await store.pg.exec("begin"); });
afterEach(async () => { await store.pg.exec("rollback"); });

async function proposal(twoRoots = false) {
  const root = `Batch approval ${crypto.randomUUID()}`;
  const actions = Array.from({ length: 105 }, (_, i) => ({ type: "create_domain", passageIds: [], input: {
    name: i ? `Child ${i}` : root, path: i ? `${root}/Child ${i}` : root, parentPath: i ? root : null,
  } }));
  if (twoRoots) actions.push({ type: "create_domain", passageIds: [], input: { name: `${root} second`, path: `${root} second`, parentPath: null } });
  const result = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
    p_event_id: null, p_cause: "edit", p_actor: "ai", p_summary: "Large root proposal", p_trace: {}, p_actions: actions,
  });
  await store.db.call("commit_change_set", { p_change_set_id: result.changeSetId });
  const row = await store.pg.query<{ id: string }>("select e.id from exceptions e join actions a on a.id=e.action_id where a.change_set_id=$1 order by a.position", [result.changeSetId]);
  return { ...result, root, exceptionId: row.rows[0]!.id, secondId: row.rows[1]?.id };
}
const answer = (id: string, accept = true) => store.db.call("resolve_exception", { p_exception_id: id, p_accept: accept, p_note: "Reviewed" });
const batch = () => store.db.call<{ complete?: boolean; position?: number; error?: string } | null>("apply_root_approval_batch");

it("saves approval immediately, replays it safely, and resumes from committed batches", async () => {
  const p = await proposal();
  expect(await answer(p.exceptionId)).toMatchObject({ queued: true });
  expect(await answer(p.exceptionId)).toMatchObject({ queued: true });
  expect((await store.pg.query("select id from domains where path=$1", [p.root])).rows).toHaveLength(0);
  expect(await batch()).toMatchObject({ complete: false, position: 24 });
  expect(await batch()).toMatchObject({ complete: false, position: 49 });
  expect(await batch()).toMatchObject({ complete: false, position: 74 });
  expect(await batch()).toMatchObject({ complete: false, position: 99 });
  expect(await batch()).toMatchObject({ complete: true, position: 104 });
  expect(await batch()).toBeNull();
  expect((await store.pg.query("select id from domains where path=$1 or starts_with(path,$1||'/')", [p.root])).rows).toHaveLength(105);
  expect((await store.pg.query<{ status: string }>("select status from change_sets where id=$1", [p.changeSetId])).rows[0]!.status).toBe("applied");
});

it("rolls back only the interrupted batch and keeps its saved approval and cursor", async () => {
  const p = await proposal();
  await answer(p.exceptionId);
  await batch();
  await store.pg.exec(`create function public.fail_root_batch_test() returns trigger language plpgsql as $$ begin
    if new.name='Child 30' then raise exception 'Simulated interrupted batch'; end if; return new; end $$;
    create trigger fail_root_batch_test before insert on domains for each row execute function public.fail_root_batch_test()`);
  expect(await batch()).toMatchObject({ error: "Simulated interrupted batch" });
  const job = await store.pg.query<{ last_position: number; failures: number }>("select last_position,failures from root_approval_jobs where change_set_id=$1", [p.changeSetId]);
  expect(job.rows[0]).toEqual({ last_position: 24, failures: 1 });
  expect((await store.pg.query("select id from domains where path=$1 or starts_with(path,$1||'/')", [p.root])).rows).toHaveLength(25);
  expect(await batch()).toBeNull(); // Persistent backoff prevents a hot retry loop.
  await store.pg.exec("drop trigger fail_root_batch_test on domains; update root_approval_jobs set available_at=now()");
  expect(await batch()).toMatchObject({ complete: false, position: 49 });
});

it("respects rejection and never creates a rejected root or its children", async () => {
  const p = await proposal();
  await answer(p.exceptionId, false);
  for (let i = 0; i < 5; i++) await batch();
  expect((await store.pg.query("select id from domains where path=$1 or starts_with(path,$1||'/')", [p.root])).rows).toHaveLength(0);
  expect(await batch()).toBeNull();
});

it("waits for every root decision and preserves mixed approvals", async () => {
  const p = await proposal(true);
  await answer(p.exceptionId);
  expect(await batch()).toBeNull();
  await answer(p.secondId!, false);
  for (let i = 0; i < 5; i++) await batch();
  expect((await store.pg.query("select id from domains where path=$1", [p.root])).rows).toHaveLength(1);
  expect((await store.pg.query("select id from domains where path=$1", [`${p.root} second`])).rows).toHaveLength(0);
});

it("does not apply a queued decision from another space", async () => {
  const p = await proposal();
  await answer(p.exceptionId);
  const owner = crypto.randomUUID(), space = crypto.randomUUID();
  const previous = (await store.pg.query<{ headers: string; claims: string }>("select current_setting('request.headers',true) headers,current_setting('request.jwt.claims',true) claims")).rows[0]!;
  await store.pg.query("insert into auth.users(id,email) values($1,'root-worker-test@example.test')", [owner]);
  await store.pg.query("insert into spaces(id,owner_id,name) values($1,$2,'Other space')", [space, owner]);
  await store.pg.query("select set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ "x-space-id": space, "x-person-id": owner }), JSON.stringify({ role: "service_role" })]);
  await store.pg.exec("set local role space_runtime");
  expect(await batch()).toBeNull();
  await store.pg.exec("reset role");
  await store.pg.query("select set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [previous.headers ?? "", previous.claims ?? ""]);
  expect(await batch()).toMatchObject({ position: 24 });
});
