import { expect, it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { TokenFactorySectionWriter } from "./tokenFactory";

// Opt-in: one paid request with synthetic claims, never user documents.
// RUN_AI_WRITER_SMOKE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/living-page/writers/provider-smoke.test.ts
it.runIf(process.env.RUN_AI_WRITER_SMOKE === "1")("preserves citations, a numerical threshold, and a planned program through the real writer", async () => {
  const settings = tokenFactoryFromEnv(process.env, process.env.AI_SMOKE_MODEL);
  if (!settings) throw new Error("Configure NEBIUS_API_KEY for the opt-in writer check.");
  const writer = new TokenFactorySectionWriter(settings);
  const result = await writer.reviseSection({
    pageTitle: "Noise protection at ExampleCo", sectionTitle: "Overview", lines: [], uncoveredUnitIds: ["noise", "planned-program"],
    units: [
      { unitId: "noise", revisionId: "r1", content: "ExampleCo requires hearing protection for employees exposed to noise of 85 dB or greater.", kind: "procedure", epistemicStatus: "established" },
      { unitId: "planned-program", revisionId: "r2", content: "ExampleCo plans to introduce a Hearing Conservation Program; the program has not yet been established.", kind: "fact", epistemicStatus: "supported" },
    ],
  });
  const text = result.add.map((line) => line.text).join(" ");
  expect([...new Set(result.add.flatMap((line) => line.unitIds))].sort()).toEqual(["noise", "planned-program"]);
  expect(text).toMatch(/85\s*(?:dB|decibels?)/i);
  expect(text).toMatch(/plan(?:s|ned)?|not yet|will (?:introduce|establish|create)/i);
  expect(text).not.toMatch(/\[\d+\]|\]\(https?:|^Certainly/i);
  console.info("Synthetic article writer check:", JSON.stringify({ style: writer.promptVersion, model: result.modelVersion, text }));
}, 150_000);
