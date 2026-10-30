import { portablePostgres } from "@/test/db/portablePostgres";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { recordUpload } from "@/lib/ingest/pipeline";

// MODULE UPKEEP QUEUE (20261130100000_module_upkeep.sql): a finished upload hands its knowledge
// to each module; a module waits for the modules before it on the same upload.
let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });
beforeEach(async () => { await store.pg.exec("begin"); });
afterEach(async () => { await store.pg.exec("rollback"); });

async function upload(hash: string) {
  const result = await recordUpload(store.db, { title: hash, mimeType: "text/plain", sourceDate: "2026-10-30T00:00:00Z", hash, storagePath: `test/${hash}.txt`,
    passages: splitIntoPassages([{ page: null, text: "Upkeep team meets weekly." }]) });
  if (result.kind !== "started") throw new Error("Expected new upload");
  return result.eventId;
}
type Claim = { id: string; eventId: string; module: string; token: string } | null;
const claim = (module: string) => store.db.call<Claim>("claim_module_upkeep", { p_module: module });

it("runs definitions first, then the wiki, then the other modules, each once", async () => {
  const eventId = await upload("upkeep-order");
  await store.db.call("enqueue_module_upkeep", { p_event_id: eventId });
  await store.db.call("enqueue_module_upkeep", { p_event_id: eventId });
  expect(await claim("wiki")).toBeNull();
  const definitions = await claim("definitions");
  expect(definitions).toMatchObject({ eventId, module: "definitions" });
  expect(await claim("definitions")).toBeNull();
  await store.db.call("finish_module_upkeep", { p_id: definitions!.id, p_token: definitions!.token, p_error: null });
  expect(await claim("glossary")).toBeNull();
  const wiki = await claim("wiki");
  await store.db.call("finish_module_upkeep", { p_id: wiki!.id, p_token: wiki!.token, p_error: null });
  for (const module of ["entities", "glossary", "curator"]) expect(await claim(module)).toMatchObject({ module });
  expect(await store.db.call("module_upkeep_status")).toEqual({
    entities: { waiting: 0, working: 1, failed: 0, cancelled: 0, error: null },
    glossary: { waiting: 0, working: 1, failed: 0, cancelled: 0, error: null },
    curator: { waiting: 0, working: 1, failed: 0, cancelled: 0, error: null },
  });
});

it("lets the next modules run once the wiki has failed for good", async () => {
  const eventId = await upload("upkeep-wiki-failed");
  await store.db.call("enqueue_module_upkeep", { p_event_id: eventId });
  const definitions = await claim("definitions");
  await store.db.call("finish_module_upkeep", { p_id: definitions!.id, p_token: definitions!.token, p_error: null });
  await store.pg.query("update public.module_upkeep set attempts = 2 where module = 'wiki'");
  const wiki = await claim("wiki");
  await store.db.call("finish_module_upkeep", { p_id: wiki!.id, p_token: wiki!.token, p_error: "Writer down" });
  expect(await claim("entities")).toMatchObject({ eventId, module: "entities" });
});

it("retries a failed item after a pause, fails it for good after three attempts, and a person's Retry starts it again", async () => {
  const eventId = await upload("upkeep-retry");
  await store.db.call("enqueue_module_upkeep", { p_event_id: eventId });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await store.pg.query("update public.module_upkeep set available_at = now() where module = 'definitions'");
    const item = await claim("definitions");
    expect(item).not.toBeNull();
    await store.db.call("finish_module_upkeep", { p_id: item!.id, p_token: item!.token, p_error: "Provider down" });
  }
  expect(await store.db.call("module_upkeep_status")).toMatchObject({ definitions: { failed: 1, error: "Provider down" } });
  expect(await store.db.call("retry_module_upkeep", { p_module: "definitions" })).toBe(1);
  expect(await claim("definitions")).toMatchObject({ eventId });
});
