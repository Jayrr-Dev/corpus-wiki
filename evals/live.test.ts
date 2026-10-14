import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getReconciliationClient } from "@/lib/ai/factory";
import { extractPdfPages, PDF_MIME_TYPE } from "@/lib/ingest/extract";
import { sha256 } from "@/lib/ingest/hash";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { reconcileUpload, recordUpload } from "@/lib/ingest/pipeline";
import { getSectionWriter } from "@/lib/living-page";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";

// =====================================================================
// LIVE CHECK AGAINST NEMOTRON (spends tokens, so it only runs on request):
//   LIVE_PDF=path/to/file.pdf npx vitest run evals/live.test.ts
// Uploads one PDF through the real pipeline (pdf text -> passages ->
// Nemotron -> Change control -> page rebuild) into a throwaway Postgres.
// =====================================================================

const LIVE_PDF = process.env.LIVE_PDF;

describe.skipIf(!LIVE_PDF || !process.env.NEBIUS_API_KEY || !hasLocalPostgres())("live upload through Nemotron", () => {
  let db: LocalPostgres;
  let client: Client;

  beforeAll(async () => {
    db = await startLocalPostgres();
    client = await db.connect();
  });

  afterAll(async () => {
    await client?.end();
    await db?.stop();
  });

  it("turns the PDF into applied knowledge", async () => {
    const bytes = new Uint8Array(readFileSync(LIVE_PDF ?? ""));
    const deps = { db: pgRpc(client), reconciler: getReconciliationClient(), writer: getSectionWriter() };
    const started = await recordUpload(deps.db, {
      title: LIVE_PDF?.split("/").at(-1) ?? "live.pdf",
      mimeType: PDF_MIME_TYPE,
      sourceDate: new Date().toISOString(),
      hash: sha256(bytes),
      storagePath: "live/test.pdf",
      passages: splitIntoPassages(await extractPdfPages(bytes.slice())),
    });
    if (started.kind !== "started") throw new Error("expected a new source");
    const result = await reconcileUpload(deps, started.eventId);
    const { rows } = await client.query(`
      select a.type, a.outcome, a.input ->> 'content' as content, a.input ->> 'path' as path, a.input ->> 'key' as key
      from public.actions a join public.change_sets cs on cs.id = a.change_set_id where cs.id = $1 order by a.position`,
      [result.changeSetId]);
    console.table(rows);
    expect(result.status).not.toBe("failed");
  }, 180_000);
});
