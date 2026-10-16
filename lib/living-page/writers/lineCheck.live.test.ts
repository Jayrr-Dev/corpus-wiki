import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import type { SectionReviseInput, SectionUnit } from "../types";
import { checkLines, type LineToCheck } from "./lineCheck";
import { TokenFactorySectionWriter } from "./tokenFactory";

// Opt-in benchmark: paid requests with public facts from three Wikipedia articles, never user documents,
// and nothing is saved. It runs the real writer (with its fact-check) on each set of claims, then
// gives the checker seeded lines with known faults. LINE_CHECK_OUT=<file> also writes the results as JSON.
// RUN_AI_LINE_CHECK=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/living-page/writers/lineCheck.live.test.ts

const claim = (unitId: string, content: string, epistemicStatus: SectionUnit["epistemicStatus"] = "established"): SectionUnit =>
  ({ unitId, revisionId: `${unitId}-r`, content, kind: "fact", epistemicStatus });

// Seeded lines: `supported` is the right verdict
type Seed = { ref: string; text: string; cites: string[]; supported: boolean; fault: string };
type Benchmark = { input: SectionReviseInput; seeds: Seed[] };

const BENCHMARKS: Benchmark[] = [
  {
    input: { pageTitle: "Men's marathon at the 1904 Summer Olympics", sectionTitle: "Hicks's victory", lines: [], uncoveredUnitIds: [], units: [
      claim("lead", "Ten miles from the finish, Thomas Hicks led the race by 1.5 miles."),
      claim("restrain", "Hicks's trainers had to stop him from lying down."),
      claim("dose", "From then until the finish, Hicks's trainers gave him several doses of strychnine mixed with brandy and egg white."),
      claim("first", "This is the earliest recorded use of performance-enhancing drugs in the modern Olympic Games."),
      claim("carried", "At the stadium, Hicks's support team carried him over the finish line while he moved his feet as if running."),
      claim("weight", "Hicks lost 8 pounds during the marathon."),
      claim("time", "Hicks won in 3:28:53, the slowest winning time in Olympic marathon history."),
    ] },
    seeds: [
      { ref: "A1", cites: ["lead", "restrain"], supported: true, fault: "none (faithful paraphrase)", text: "Hicks led by 1.5 miles with ten miles to go, but his trainers had to keep him from lying down." },
      { ref: "A2", cites: ["dose"], supported: false, fault: "invented detail (who supplied it, how many doses)", text: "His trainers gave him three doses of strychnine supplied by the race doctor." },
      { ref: "A3", cites: ["weight", "time"], supported: false, fault: "changed number", text: "Hicks won in 3:28:53 and lost 18 pounds during the race." },
      { ref: "A4", cites: ["first"], supported: false, fault: "overgeneralised scope (modern Olympics → any sport)", text: "It is the earliest recorded use of performance-enhancing drugs in any sport." },
      { ref: "A5", cites: ["lead"], supported: true, fault: "none (repeats the claim word for word)", text: "Ten miles from the finish, Thomas Hicks led the race by 1.5 miles." },
      { ref: "A6", cites: ["dose", "carried"], supported: true, fault: "none (says less than the claims)", text: "Hicks's trainers gave him strychnine, and his support team carried him over the finish line." },
    ],
  },
  {
    input: { pageTitle: "Time Cube", sectionTitle: "Overview", lines: [], uncoveredUnitIds: [], units: [
      claim("site", "Time Cube was a personal website that Otis Eugene \"Gene\" Ray set up in 1997."),
      claim("pseudo", "Time Cube is described as pseudoscientific."),
      claim("theory", "Ray's theory, also called Time Cube, holds that each day consists of four days occurring at the same time."),
      claim("wisest", "Ray called himself the \"wisest man on earth\".", "supported"),
      claim("conspiracy", "Ray asserted that modern science takes part in a worldwide conspiracy to ignore his theory.", "supported"),
      claim("died", "Ray died in March 2015."),
      claim("expired", "The Time Cube website registration expired in August 2015."),
    ] },
    seeds: [
      { ref: "A1", cites: ["site", "pseudo"], supported: true, fault: "none (faithful paraphrase)", text: "Time Cube was a pseudoscientific personal website that Gene Ray created in 1997." },
      { ref: "A2", cites: ["conspiracy"], supported: false, fault: "attributed assertion stated as fact", text: "Modern science takes part in a worldwide conspiracy to ignore Ray's theory." },
      { ref: "A3", cites: ["died", "expired"], supported: false, fault: "invented cause", text: "The website registration expired in August 2015 because Ray had died that March." },
      { ref: "A4", cites: ["wisest"], supported: true, fault: "none (keeps attribution)", text: "Ray described himself as the \"wisest man on earth\"." },
    ],
  },
  {
    input: { pageTitle: "Ed Wood", sectionTitle: "Military service", lines: [], uncoveredUnitIds: [], units: [
      claim("enlist", "Ed Wood enlisted in the United States Marine Corps in 1942, at age 17."),
      claim("rank", "Wood reached the rank of corporal and was discharged in 1946."),
      claim("claimed", "Wood reportedly claimed that a Japanese soldier knocked out his front teeth in combat.", "supported"),
      claim("actual", "Wood's actual service included recovering bodies on Betio after the Battle of Tarawa and minor Japanese bombing raids."),
      claim("teeth", "Navy dentists removed Wood's teeth over several months, unconnected to any combat."),
      claim("clerical", "A recurring filariasis infection left Wood doing clerical work for the rest of his enlistment."),
    ] },
    seeds: [
      { ref: "A1", cites: ["claimed", "teeth"], supported: false, fault: "claim stated as fact", text: "Wood lost his front teeth in combat with a Japanese soldier." },
      { ref: "A2", cites: ["enlist", "rank"], supported: true, fault: "none (faithful paraphrase)", text: "Wood joined the Marine Corps in 1942 at 17 and left as a corporal in 1946." },
      { ref: "A3", cites: ["clerical"], supported: false, fault: "invented consequence", text: "A filariasis infection ended Wood's enlistment early." },
      { ref: "A4", cites: ["actual"], supported: false, fault: "dropped qualifier (minor raids → heavy fighting)", text: "Wood's service included recovering bodies on Betio and heavy fighting during Japanese bombing raids." },
      { ref: "A5", cites: ["claimed", "teeth"], supported: true, fault: "none (keeps the claim attributed)", text: "Wood reportedly claimed that a Japanese soldier knocked out his front teeth in combat, but Navy dentists removed them over several months, unconnected to any combat." },
    ],
  },
];

it.runIf(process.env.RUN_AI_LINE_CHECK === "1")("writes faithful lines and catches seeded faults on Wikipedia benchmark claims", async () => {
  const settings = tokenFactoryFromEnv(process.env, process.env.AI_SMOKE_MODEL);
  if (!settings) throw new Error("Configure NEBIUS_API_KEY for the opt-in line check.");
  const writer = new TokenFactorySectionWriter(settings);
  const dropped: unknown[] = [];
  const warn = console.warn;
  console.warn = (message: unknown, detail?: unknown) => { if (message === "Writer line dropped by the fact-check") dropped.push(detail); else warn(message, detail); };
  const results = [];
  try {
    for (const { input: base, seeds } of BENCHMARKS) {
      const input = { ...base, uncoveredUnitIds: base.units.map((unit) => unit.unitId) };
      const revision = await writer.reviseSection(input);
      const covered = new Set(revision.add.flatMap((line) => line.unitIds));
      const contentOf = new Map(input.units.map((unit, index) => [unit.unitId, { ref: `C${index + 1}`, claim: unit.content, status: unit.epistemicStatus }]));
      const seeded: LineToCheck[] = seeds.map((seed) => ({ ref: seed.ref, text: seed.text, claims: seed.cites.map((id) => contentOf.get(id)!) }));
      const { verdicts } = await checkLines(settings, { page: input.pageTitle, section: input.sectionTitle, lines: seeded, sectionClaims: [...contentOf.values()] });
      const seedResults = seeds.map((seed) => {
        const verdict = verdicts.find((item) => item.line === seed.ref);
        return { ...seed, verdict: verdict?.supported ?? null, problem: verdict?.problem ?? "", overruled: verdict?.overruled ?? null, correct: verdict?.supported === seed.supported };
      });
      results.push({ page: input.pageTitle, section: input.sectionTitle, model: revision.modelVersion, tokensIn: revision.tokensIn, tokensOut: revision.tokensOut,
        lines: revision.add.map((line) => ({ text: line.text, claims: line.unitIds })), uncovered: input.units.filter((unit) => !covered.has(unit.unitId)).map((unit) => unit.unitId), seeds: seedResults });
    }
  } finally {
    console.warn = warn;
  }
  const report = { model: settings.model, dropped, results };
  console.info("LINE CHECK BENCHMARK", JSON.stringify(report, null, 2));
  if (process.env.LINE_CHECK_OUT) writeFileSync(process.env.LINE_CHECK_OUT, JSON.stringify(report, null, 2));
  for (const result of results) {
    expect(result.lines.length, `${result.page}: the writer wrote nothing`).toBeGreaterThan(0);
    for (const seed of result.seeds) expect(seed.correct, `${result.page} ${seed.ref} (${seed.fault}): ${seed.problem}`).toBe(true);
  }
}, 600_000);
