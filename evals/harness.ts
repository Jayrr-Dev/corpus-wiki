import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
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

// Builds the harness on a test DB connection. Not built yet: agents B and C replace this.
export function createEvalHarness(client: Client): EvalHarness {
  void client;
  throw new Error("createEvalHarness is not implemented yet (needs agent B's commit and agent C's upload).");
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
