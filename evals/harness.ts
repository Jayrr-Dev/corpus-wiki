import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { FakeReconciliationClient } from "@/lib/ai";
import { revertChangeSet } from "@/lib/change-control";
import { extractPlainText } from "@/lib/ingest/extract";
import { sha256 } from "@/lib/ingest/hash";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { type PipelineDeps, reconcileUpload, recordUpload } from "@/lib/ingest/pipeline";
import { getSectionWriter } from "@/lib/living-page";
import { pgRpc } from "@/test/db/pgRpc";
import type { EvalCase, EvalStep, FixtureFile } from "./cases";
import { type StoreSnapshot, snapshotStore } from "./snapshot";

// =====================================================================
// EVAL HARNESS: runs a case's steps against the throwaway database.
// The two operations below are the seams agents B and C fill:
//   upload -> C (source, passages, event, reconciliation -> draft ChangeSet)
//             then B (checks + commit_change_set)
//   undo   -> B
// =====================================================================

export interface EvalHarness {
  // Ingests one fixture file end to end; returns the ChangeSet it produced (null if skipped)
  upload(fixture: FixtureFile, text: string): Promise<{ changeSetId: string | null }>;
  // Reverts one applied ChangeSet
  undo(changeSetId: string): Promise<void>;
}

// Builds the harness on a test DB connection: the app's own pipeline and Change control,
// with the fake model (canned ChangeSets) and the fake section writer (no network)
export function createEvalHarness(client: Client): EvalHarness {
  const deps: PipelineDeps = { db: pgRpc(client), reconciler: new FakeReconciliationClient(), writer: getSectionWriter({ NODE_ENV: "test" }) };
  return {
    upload: (fixture, text) => uploadFixture(deps, fixture, text),
    undo: async (changeSetId) => {
      await revertChangeSet(deps.db, changeSetId);
    },
  };
}

// One fixture through both upload steps, as the Upload screen runs them
async function uploadFixture(deps: PipelineDeps, fixture: FixtureFile, text: string) {
  const hash = sha256(text);
  const started = await recordUpload(deps.db, {
    title: fixture.file,
    mimeType: "text/markdown",
    sourceDate: `${fixture.date}T00:00:00Z`,
    hash,
    storagePath: `evals/${fixture.file}`,
    passages: splitIntoPassages(extractPlainText(text)),
  });
  if (started.kind === "skipped") return { changeSetId: null };
  const result = await reconcileUpload(deps, started.eventId);
  if (result.status === "failed") throw new Error(`${fixture.file}: ${result.error}`);
  return { changeSetId: result.changeSetId };
}

// Reads a fixture's text from evals/fixtures
export function readFixture(fixture: FixtureFile): string {
  return readFileSync(join(import.meta.dirname, "fixtures", fixture.file), "utf8");
}

// The result the eval test compares: the store before and after the last step
export type CaseRun = { beforeLast: StoreSnapshot; after: StoreSnapshot };

// Runs every step in order, snapshotting around the last one
export async function runCase(client: Client, harness: EvalHarness, evalCase: EvalCase): Promise<CaseRun> {
  const changeSetIds: (string | null)[] = [];
  let beforeLast = await snapshotStore(client);
  for (const [index, step] of evalCase.steps.entries()) {
    if (index === evalCase.steps.length - 1) beforeLast = await snapshotStore(client);
    changeSetIds.push(await runStep(harness, step, changeSetIds));
  }
  return { beforeLast, after: await snapshotStore(client) };
}

// One step: an upload, or an undo of an earlier step's ChangeSet
async function runStep(harness: EvalHarness, step: EvalStep, changeSetIds: (string | null)[]): Promise<string | null> {
  if (step.kind === "upload") return (await harness.upload(step.fixture, readFixture(step.fixture))).changeSetId;
  const target = changeSetIds[step.ofStep];
  if (!target) throw new Error(`Step ${step.ofStep} produced no ChangeSet to undo`);
  await harness.undo(target);
  return null;
}
