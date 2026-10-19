import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("only expires unused deleted assets after seven days and queues their files", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const create = async (deleted: string | null, path: string) => (await pg.query<{ id: string }>(
      "insert into assets(kind,origin,storage_path,mime_type,title,deleted_at) values('image','external',$1,'image/png','Cleanup test',$2::timestamptz) returning id", [path, deleted])).rows[0]!.id;
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    const recent = new Date(Date.now() - 6 * 86400000).toISOString();
    const expired = await create(old, "composer-images/expired.png");
    const fresh = await create(recent, "composer-images/recent.png");
    const active = await create(null, "composer-images/active.png");
    const restored = await create(null, "composer-images/restored.png");
    await pg.query("update assets set created_at=now()-interval '30 days' where id=$1", [active]);
    expect(await db.call("expire_deleted_assets")).toBe(1);
    expect((await pg.query("select id from assets where id=$1", [expired])).rows).toHaveLength(0);
    expect((await pg.query("select id from assets where id=any($1::uuid[])", [[fresh, active, restored]])).rows).toHaveLength(3);
    await expect(db.call("purge_deleted_asset", { p_asset_id: active })).rejects.toThrow("Deleted first");
    expect(await db.call("purge_deleted_asset", { p_asset_id: restored, p_expired_only: true })).toBe(false);
    expect(await db.call("purge_deleted_asset", { p_asset_id: fresh })).toBe(true);
    const files = await db.call<{ id: string; bucket: string; path: string }[]>("pending_asset_file_cleanup");
    expect(files.map((f) => f.path).sort()).toEqual(["expired.png", "recent.png"]);
    await db.call("finish_asset_file_cleanup", { p_id: files[0]!.id });
    expect(await db.call("pending_asset_file_cleanup")).toHaveLength(1);
    expect(await db.call("purge_deleted_asset", { p_asset_id: fresh })).toBe(false);
  } finally { await pg.close(); }
});

it("protects in-use images and cascades generated image content on permanent deletion", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const source = (await pg.query<{ id: string }>("select id from sources limit 1")).rows[0]!.id;
    const used = (await pg.query<{ id: string }>("insert into assets(source_id,kind,storage_path,mime_type,deleted_at) values($1,'image','source.png','image/png',now()-interval '8 days') returning id", [source])).rows[0]!.id;
    expect(await db.call("expire_deleted_assets")).toBe(0);
    await expect(db.call("purge_deleted_asset", { p_asset_id: used })).rejects.toThrow("still in use");
    const generated = (await pg.query<{ id: string }>("insert into assets(kind,origin,storage_path,mime_type,deleted_at) values('image','generated','generated/vector/test.svg','image/svg+xml',now()) returning id")).rows[0]!.id;
    await pg.query("insert into generated_asset_content(asset_id,svg,original_caption) values($1,'<svg/>','Test')", [generated]);
    expect(await db.call("purge_deleted_asset", { p_asset_id: generated })).toBe(true);
    expect((await pg.query("select asset_id from generated_asset_content where asset_id=$1", [generated])).rows).toHaveLength(0);
    expect(await db.call("pending_asset_file_cleanup")).toEqual([]);
  } finally { await pg.close(); }
});
