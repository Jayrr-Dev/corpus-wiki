import { expect, it } from "vitest";
import { DEFAULT_AI_MODEL } from "./config";
import { TokenFactoryReconciliationClient } from "./tokenFactory/client";

// Opt-in only: this makes one small paid inference request, with synthetic text.
// RUN_AI_SMOKE=1 AI_SMOKE_MODEL=<model id> node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/ai/provider-smoke.test.ts
it.runIf(process.env.RUN_AI_SMOKE === "1")("extracts a cited claim through the real Nebius provider", async () => {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("NEBIUS_API_KEY is required for the opt-in provider check.");
  const model = process.env.AI_SMOKE_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const client = new TokenFactoryReconciliationClient({ apiKey, model });
  const draft = await client.draftChangeSet({
    source: { id: "smoke-source", title: "Synthetic visitor policy", sourceDate: "2026-10-14T00:00:00Z" },
    passages: [{ id: "smoke-passage", position: 0, text: "ExampleCo requires all visitors to sign in at reception.", speakerLabel: null }],
    existingUnits: [], domainPaths: [], entities: [],
  });
  const claims = draft.actions.filter((action) => action.type === "add_claim");
  expect(claims.length).toBeGreaterThan(0);
  expect(claims.every((claim) => claim.passageIds.includes("smoke-passage"))).toBe(true);
  console.info("Nebius smoke check:", JSON.stringify({ ...draft.trace, claimCount: claims.length }));
}, 150_000);
