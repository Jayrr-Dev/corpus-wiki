import { afterEach, expect, it, vi } from "vitest";
import { stubTutor, TUTOR_SETTINGS, writeQuestions } from "./fakeTutor";
import { generateStudyItems, shuffle, toItem } from "./generate";

afterEach(() => vi.unstubAllGlobals());

const claims = Array.from({ length: 23 }, (_, index) => ({ unitId: `unit-${index}`, revisionId: `rev-${index}`, title: `Claim ${index}`, content: `fact ${index}` }));

it("writes one question per claim and kind, about ten claims per Tutor call", async () => {
  const tutor = stubTutor(writeQuestions);
  const progress: [number, number][] = [];
  const batches: number[] = [];
  const { items, usage } = await generateStudyItems(TUTOR_SETTINGS, claims, ["flashcard", "multiple_choice"], {
    instructions: "Tutor rules.", onProgress: (done, total) => progress.push([done, total]), onBatch: async (batch) => { batches.push(batch.length); },
  });
  expect(tutor.calls).toHaveLength(3);
  expect(tutor.calls.map((call) => (call.data.claims as unknown[]).length)).toEqual([10, 10, 3]);
  // Through the Tutor role: its own model and its instructions
  expect(tutor.calls.every((call) => call.purpose === "study_questions" && call.model === "tutor/model")).toBe(true);
  expect(tutor.calls[0]!.messages.some((message) => message.role === "system" && message.content.includes("Tutor rules."))).toBe(true);
  expect(items).toHaveLength(46);
  expect(batches).toEqual([20, 20, 6]);
  expect(progress).toEqual([[0, 46], [20, 46], [40, 46], [46, 46]]);
  expect(usage).toEqual({ tokensIn: 30, tokensOut: 15 });
  // Every item keeps its claim and the revision it came from
  for (const item of items) expect(item.revisionId).toBe(item.unitId.replace("unit", "rev"));
  const choice = items.find((item) => item.kind === "multiple_choice" && item.unitId === "unit-4")!;
  expect(choice.answer).toBe("A fact 4");
  expect([...choice.choices!].sort()).toEqual(["A fact 4", "Wrong one", "Wrong three", "Wrong two"]);
  expect(items.find((item) => item.kind === "flashcard")!.choices).toBeNull();
});

it("offers sibling claims outside the batch as material for wrong options", async () => {
  const tutor = stubTutor(writeQuestions);
  const siblings = [...claims.slice(0, 2), { unitId: "other", revisionId: "r", title: "Sibling", content: "sibling fact" }];
  await generateStudyItems(TUTOR_SETTINGS, claims.slice(0, 2), ["multiple_choice"], { siblings });
  expect(tutor.calls[0]!.data.siblings).toEqual([{ title: "Sibling", claim: "sibling fact" }]);
});

it("drops questions that do not hold up and repeats of one claim and kind", async () => {
  stubTutor(() => ({ items: [
    { claim: "c1", kind: "flashcard", prompt: "Front", answer: "Back", wrongChoices: [], explanation: "" },
    { claim: "c1", kind: "flashcard", prompt: "Front again", answer: "Back", wrongChoices: [], explanation: "" },
    { claim: "c9", kind: "flashcard", prompt: "Unknown claim", answer: "Back", wrongChoices: [], explanation: "" },
    { claim: "c2", kind: "short_answer", prompt: "Not asked for", answer: "Back", wrongChoices: [], explanation: "" },
    { claim: "c2", kind: "multiple_choice", prompt: "Answer among wrong", answer: "Yes", wrongChoices: ["yes", "No", "Maybe"], explanation: "" },
  ] }));
  const { items } = await generateStudyItems(TUTOR_SETTINGS, claims.slice(0, 2), ["flashcard", "multiple_choice"]);
  expect(items.map((item) => [item.unitId, item.kind, item.prompt])).toEqual([["unit-0", "flashcard", "Front"]]);
});

it("builds four shuffled options with the answer among them", () => {
  const refs = new Map([["c1", claims[0]!]]);
  const draft = { claim: "c1", kind: "multiple_choice" as const, prompt: "Which?", answer: "Right", wrongChoices: ["W1", "W2", "W3"], explanation: "" };
  expect(toItem(draft, refs, ["multiple_choice"], () => 0)!.choices).toEqual(["W1", "W2", "W3", "Right"]);
  expect(toItem({ ...draft, wrongChoices: ["W1", "W1", "W2"] }, refs, ["multiple_choice"])).toBeNull();
  expect(shuffle([1, 2, 3], () => 0.99)).toEqual([1, 2, 3]);
});
