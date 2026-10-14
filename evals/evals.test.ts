import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { EVAL_CASES } from "./cases";
import { createEvalHarness, runCase } from "./harness";
import { compareToExpected } from "./snapshot";

// =====================================================================
// EVALS E1–E7 against a throwaway Postgres loaded with the seed.
// The harness runs the app's own upload pipeline and Change control with the
// fake model, so every case checks the real checks, commit and undo.
// Each case gets a fresh database so cases never see each other's changes.
// =====================================================================

describe.skipIf(!hasLocalPostgres())("evals", () => {
  for (const evalCase of EVAL_CASES) {
    describe(`${evalCase.id} ${evalCase.name}`, () => {
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

      it(evalCase.expected.note, async () => {
        const run = await runCase(client, createEvalHarness(client), evalCase);
        expect(compareToExpected(run.beforeLast, run.after, evalCase.expected)).toEqual([]);
      });
    });
  }
});
