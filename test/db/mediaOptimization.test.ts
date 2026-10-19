import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("automatically queues stored media once, excludes deleted assets and remembers completed work", async () => {
  const { pg, db } = await portablePostgres();
  try {
    await pg.query("insert into assets(kind,origin,storage_path,mime_type) values('image','external','composer-images/test.png','image/png')");
    await pg.query("insert into assets(kind,origin,storage_path,mime_type,deleted_at) values('image','external','composer-images/deleted.png','image/png',now())");
    const job = await db.call<{ bucket: string; path: string; mime: string }>("claim_media_optimization");
    expect(job).toEqual({ bucket: "composer-images", path: "test.png", mime: "image/png" });
    expect(await db.call("claim_media_optimization")).toBeNull();
    await db.call("finish_media_optimization", { p_bucket: job.bucket, p_path: job.path, p_success: true });
    expect(await db.call("claim_media_optimization")).toBeNull();
  } finally { await pg.close(); }
});
