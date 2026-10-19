import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("unlinks deleted images from current and historical figures and hidden stakeholder cards", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const asset = (await pg.query<{ id: string }>("insert into assets(kind,origin,storage_path,mime_type,media_url,deleted_at) values('image','external','composer-images/unlink.png','image/png','https://example.com/logo.png',now()) returning id")).rows[0]!.id;
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Unlink test','unlink-test') returning id")).rows[0]!.id;
    const snapshot = await db.call("composer_page_snapshot", { p_page_id: page });
    const figures = [{ assetId: asset, svg: "", caption: "Remove" }, { assetId: "10000000-0000-4000-8000-000000000099", svg: "", caption: "Keep" }];
    for (const active of [false, true]) await pg.query("insert into composer_runs(page_id,snapshot,composition,review,model,active) values($1,$2,$3,'{}','test',$4)", [page, JSON.stringify(snapshot), JSON.stringify({ figures }), active]);
    const entity = (await pg.query<{ id: string }>("select id from entities limit 1")).rows[0]!.id;
    await pg.query("insert into entity_profiles(entity_id,is_stakeholder,hidden,logo_url) values($1,true,true,'https://example.com/logo.png') on conflict(entity_id) do update set logo_url=excluded.logo_url, hidden=true", [entity]);
    expect(await db.call("unlink_deleted_asset", { p_asset_id: asset })).toBe(3);
    expect(await db.call("asset_app_usage")).not.toEqual(expect.arrayContaining([expect.objectContaining({ assetId: asset })]));
    expect((await pg.query<{ composition: { figures: unknown[] } }>("select composition from composer_runs where page_id=$1", [page])).rows.every((r) => r.composition.figures.length === 1)).toBe(true);
    expect((await pg.query<{ logo_url: string | null }>("select logo_url from entity_profiles where entity_id=$1", [entity])).rows[0]!.logo_url).toBeNull();
    expect((await pg.query("select id from assets where id=$1", [asset])).rows).toHaveLength(1);
    expect(await db.call("purge_deleted_asset", { p_asset_id: asset })).toBe(true);
  } finally { await pg.close(); }
});

it("refuses unlinking active assets and preserves source evidence", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const active = (await pg.query<{ id: string }>("insert into assets(kind,origin,storage_path,mime_type) values('image','external','test.png','image/png') returning id")).rows[0]!.id;
    await expect(db.call("unlink_deleted_asset", { p_asset_id: active })).rejects.toThrow("Deleted first");
    const source = (await pg.query<{ id: string }>("select id from sources limit 1")).rows[0]!.id;
    const asset = (await pg.query<{ id: string }>("insert into assets(source_id,kind,storage_path,mime_type,deleted_at) values($1,'image','test.png','image/png',now()) returning id", [source])).rows[0]!.id;
    await expect(db.call("unlink_deleted_asset", { p_asset_id: asset })).rejects.toThrow("belongs to a source");
  } finally { await pg.close(); }
});
