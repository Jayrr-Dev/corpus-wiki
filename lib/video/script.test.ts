import { describe, expect, it } from "vitest";
import { applyScriptEdit, draftSchema, type ScriptClaim, scriptEditSchema, scriptFromDraft, scriptPrompt, scriptSources } from "./script";
import { scene } from "./testing";

const claims: ScriptClaim[] = [
  { unitId: "u0", revisionId: "r0", title: "Zero", content: "Claim zero." },
  { unitId: "u1", revisionId: "r1", title: null, content: "Claim one." },
];

let next = 0;
const ids = () => `s${next++}`;

const draftScene = (narration: string, claims: number[]) => ({ narration, title: narration, bullets: [], visual: "list" as const, claims });
const opening = draftScene("Intro.", [0]);
const closing = draftScene("Outro.", [1]);

describe("writing the script", () => {
  it("asks for the length's scenes and numbers the claims", () => {
    const prompt = scriptPrompt({ scopeLabel: "Water", claims, length: "short" });
    expect(prompt).toContain("about 60 seconds: an intro, 4 scenes and an outro");
    expect(prompt).toContain("[0] Zero: Claim zero.");
    expect(prompt).toContain("[1] Claim one.");
  });

  it("turns the draft into scenes citing claims with their revisions", () => {
    next = 0;
    const script = scriptFromDraft({ title: "T", intro: opening, scenes: [{ narration: " Hello. ", title: "Hi", bullets: ["a", " "], visual: "title", claims: [1, 1, 0] }], outro: closing }, claims, ids);
    expect(script.scenes[1]).toEqual({ id: "s1", narration: "Hello.", title: "Hi", bullets: ["a"], visual: "title", assetId: null, graphic: null, sources: [
      { unitId: "u1", revisionId: "r1", title: null },
      { unitId: "u0", revisionId: "r0", title: "Zero" },
    ] });
  });

  it("always opens with the intro and closes with the outro", () => {
    const script = scriptFromDraft({ title: "T", intro: draftScene("Intro.", [9]), scenes: [draftScene("Body.", [0])], outro: closing }, claims, ids);
    expect(script.scenes.map((item) => item.narration)).toEqual(["Intro.", "Body.", "Outro."]);
    expect(script.scenes[0]!.sources).toEqual([]);
  });

  it("refuses a draft without an intro or outro", () => {
    expect(draftSchema.safeParse({ title: "T", scenes: [{ ...draftScene("a", [0]), graphic: "" }], outro: { ...closing, graphic: "" } }).success).toBe(false);
    expect(draftSchema.safeParse({ title: "T", intro: { ...opening, graphic: "" }, scenes: [{ ...draftScene("a", [0]), graphic: "" }] }).success).toBe(false);
  });

  it("drops claim numbers that do not exist, and scenes left with none", () => {
    const script = scriptFromDraft({ title: "T", intro: opening, scenes: [draftScene("a", [7]), draftScene("b", [0, 9])], outro: closing }, claims, ids);
    expect(script.scenes.map((item) => item.narration)).toEqual(["Intro.", "b", "Outro."]);
    expect(() => scriptFromDraft({ title: "T", intro: opening, scenes: [draftScene("a", [5])], outro: closing }, claims, ids)).toThrow("no scenes");
  });

  it("requires every drafted scene to cite a claim", () => {
    const ok = { title: "T", intro: { ...opening, graphic: "" }, scenes: [{ ...draftScene("a", [0]), graphic: "" }], outro: { ...closing, graphic: "" } };
    expect(draftSchema.safeParse(ok).success).toBe(true);
    expect(draftSchema.safeParse({ ...ok, scenes: [{ ...draftScene("a", []), graphic: "" }] }).success).toBe(false);
  });
});

describe("editing the script", () => {
  const voiced = { scenes: [scene("a", "Alpha.", { audioPath: "a.mp3", durationMs: 900, captions: [] }), scene("b", "Beta.", { audioPath: "b.mp3", durationMs: 800, captions: [] }), scene("c")] };
  const edit = (scenes: { id: string; narration: string }[]) => scriptEditSchema.parse({ title: "T", scenes: scenes.map((item) => ({ ...item, title: "x", bullets: ["p"], visual: "list" })) });

  it("reorders and drops scenes, keeping sources and voicing where narration did not change", () => {
    const script = applyScriptEdit(voiced, edit([{ id: "b", narration: "Beta." }, { id: "a", narration: "Alpha changed." }]));
    expect(script.scenes.map((item) => item.id)).toEqual(["b", "a"]);
    expect(script.scenes[0]).toMatchObject({ audioPath: "b.mp3", durationMs: 800, title: "x", sources: voiced.scenes[1]!.sources });
    expect(script.scenes[1]).toMatchObject({ narration: "Alpha changed.", audioPath: null, durationMs: null, captions: null });
  });

  it("refuses scenes it does not know or repeats", () => {
    expect(() => applyScriptEdit(voiced, edit([{ id: "z", narration: "New." }]))).toThrow("Reload");
    expect(() => applyScriptEdit(voiced, edit([{ id: "a", narration: "A." }, { id: "a", narration: "A." }]))).toThrow("Reload");
  });

  it("needs narration and at least one scene", () => {
    expect(scriptEditSchema.safeParse({ title: "T", scenes: [] }).success).toBe(false);
    expect(scriptEditSchema.safeParse({ title: "T", scenes: [{ id: "a", narration: " ", title: "x", bullets: [], visual: "list" }] }).error?.issues[0]?.message).toBe("Every scene needs narration.");
  });

  it("lists every cited claim once", () => {
    const shared = scene("d", "x", { sources: voiced.scenes[0]!.sources });
    expect(scriptSources({ scenes: [voiced.scenes[0]!, shared, voiced.scenes[1]!] }).map((source) => source.unitId)).toEqual(["unit-a", "unit-b"]);
  });
});
