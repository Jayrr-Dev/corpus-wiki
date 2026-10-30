import { afterEach, expect, it, vi } from "vitest";
import { portablePostgres } from "@/test/db/portablePostgres";
import { uploadChangeCounts, uploadFixture } from "@/test/db/uploadFixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// CHANGE SETS PER UPLOAD (#49), before and after the stage fold, on the synthetic
// fixtures (short: 8 groups of 9 claims; long: 16 groups of 12). Prints the numbers.
it.runIf(process.env.PROCESSING_SYNTHETIC === "1")("counts change sets per upload before and after folding stages", async () => {
  vi.stubEnv("PROCESSING_SHARED_LIMITS", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Synthetic processing must not access the network"); }));
  const store = await portablePostgres();
  try {
    await store.pg.exec("alter table public.upload_workflows disable trigger fold_upload_stages");
    const results = [];
    for (const [name, entities, claimsEach] of [["short", 8, 9], ["long", 16, 12]] as const) {
      const upload = await uploadFixture(store, name, entities, claimsEach);
      expect(upload.result).toMatchObject({ error: null, workflow: { state: "complete" } });
      const before = await uploadChangeCounts(store, upload.eventId);
      await store.pg.query("select change_control.fold_upload_stages($1)", [upload.eventId]);
      const after = await uploadChangeCounts(store, upload.eventId);
      results.push({ scenario: name, claims: upload.claims, before, after, reduction: Math.round((before.sets / after.sets) * 10) / 10 });
    }
    console.log("Change sets per upload", JSON.stringify(results));
    for (const result of results) expect(result.reduction).toBeGreaterThanOrEqual(10);
  } finally { await store.pg.close(); }
}, 300_000);
