import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });

it("reads sourced claims in one consistent snapshot and supports an empty selection", async () => {
  const claims = await store.db.call<{ id: string; revisionId: string; sourceEvidence: { sourceId: string; text: string }[] }[]>("glossary_claim_snapshot");
  expect(claims.length).toBeGreaterThan(0);
  expect(claims.every((claim) => claim.sourceEvidence.length > 0)).toBe(true);
  expect(await store.db.call("glossary_claim_snapshot", { p_unit_ids: [] })).toEqual([]);
  expect(await store.db.call("glossary_claim_snapshot", { p_unit_ids: [claims[0]!.id] })).toEqual([claims[0]]);
});

it("retains same-input live definitions on recovery, clears superseded inputs and finalizes atomically", async () => {
  const claim = (hash: string) => store.db.call<string>("claim_glossary_generation", { p_hash: hash });
  const state = async () => (await store.pg.query<{ live_entries: unknown[]; live_input_hash: string | null; status: string }>("select live_entries,live_input_hash,status from glossary_state")).rows[0]!;
  await claim("current");
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"Reviewed definition"}]',lease_token=null,lease_until=null,status='error'`);
  const view = await store.db.call<{ live_entries: unknown[]; status: string }>("read_glossary_view");
  expect(view.live_entries).toHaveLength(1);
  expect(view.status).toBe("error");
  await claim("current");
  expect((await state()).live_entries).toHaveLength(1);
  await store.pg.exec("update glossary_state set lease_token=null,lease_until=null,status='error'");
  const token = await claim("changed");
  expect((await state()).live_entries).toEqual([]);
  expect((await state()).live_input_hash).toBe("changed");
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"New reviewed definition"}]'`);
  await store.db.call("publish_glossary_meanings", { p_token: token, p_hash: "changed", p_entries: [], p_pending: [], p_registry: {}, p_batches: {} });
  expect(await state()).toEqual({ live_entries: [], live_input_hash: null, status: "ready" });
});

it("keeps the furthest live definitions while a recovered review replays earlier checks", async () => {
  await store.db.call("claim_glossary_generation", { p_hash: "recovery-check" });
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"Furthest saved definition"}]',
    review_cache='{"review_progress":{"phase":"comparing","completed":600,"total":994}}'`);
  await store.pg.exec(`update glossary_state set review_cache='{}',live_entries='[]'`);
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"Earlier replay"}]',
    review_cache='{"review_progress":{"phase":"comparing","completed":100,"total":994}}'`);
  let view = await store.db.call<{ live_entries: { term: string }[] }>("read_glossary_view");
  expect(view.live_entries).toEqual([{ term: "Furthest saved definition" }]);
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"Updated definition after catch-up"}]',
    review_cache='{"review_progress":{"phase":"comparing","completed":601,"total":994}}'`);
  view = await store.db.call("read_glossary_view");
  expect(view.live_entries).toEqual([{ term: "Updated definition after catch-up" }]);
  await store.pg.exec("update glossary_state set lease_token=null,lease_until=null,status='error'");
  await store.db.call("claim_glossary_generation", { p_hash: "different-input" });
  view = await store.db.call("read_glossary_view");
  expect(view.live_entries).toEqual([]);
  await store.pg.exec(`update glossary_state set live_entries='[{"term":"First definition from new input"}]',
    review_cache='{"review_progress":{"phase":"comparing","completed":1,"total":994}}'`);
  view = await store.db.call("read_glossary_view");
  expect(view.live_entries).toEqual([{ term: "First definition from new input" }]);
});
