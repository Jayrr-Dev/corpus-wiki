import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { recordUpload } from "@/lib/ingest/pipeline";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); }, 60000);
afterAll(async () => { await store?.pg.close(); });

it("blocks repeated names and bytes without opening another event, but permits explicit replacement", async () => {
  const record = { title: "Application.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sourceDate: "2026-10-17T00:00:00Z", hash: "original", storagePath: "test/original", passages: [], rejectSameName: true };
  const first = await recordUpload(store.db, record);
  expect(first.kind).toBe("started");
  for (const repeated of [record, { ...record, title: "  APPLICATION.docx  ", hash: "saved-again" }, { ...record, title: "Renamed.docx" }]) {
    expect(await recordUpload(store.db, repeated)).toEqual({ kind: "skipped", sourceId: first.sourceId });
  }
  expect((await store.pg.query("select id from public.shift_events where source_id=$1", [first.sourceId])).rows).toHaveLength(1);
  const replacement = await recordUpload(store.db, { ...record, hash: "replacement", rejectSameName: false });
  expect(replacement.kind).toBe("started");
  expect(replacement.sourceId).not.toBe(first.sourceId);
  expect(await recordUpload(store.db, { ...record, title: "Different.docx", hash: "different" })).toMatchObject({ kind: "started" });
});
