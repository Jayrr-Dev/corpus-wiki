import { afterEach, expect, it, vi } from "vitest";
import { stubTutor, TUTOR_SETTINGS } from "./fakeTutor";
import { gradeShortAnswer } from "./grade";

afterEach(() => vi.unstubAllGlobals());

const input = { question: "How far apart must gas and power lines be?", expected: "At least 300 mm.", claim: { title: "Separation", content: "Gas and power lines must be at least 300 mm apart." }, response: "300 mm" };

it("grades a short answer against the claim through the Tutor", async () => {
  const tutor = stubTutor(() => ({ result: "partly", feedback: "Right distance, but say it is a minimum." }));
  const grade = await gradeShortAnswer(TUTOR_SETTINGS, input, { instructions: "Tutor rules." });
  expect(grade).toEqual({ result: "partly", feedback: "Right distance, but say it is a minimum.", usage: { tokensIn: 10, tokensOut: 5 } });
  expect(tutor.calls).toHaveLength(1);
  expect(tutor.calls[0]).toMatchObject({ purpose: "study_grade", model: "tutor/model" });
  expect(tutor.calls[0]!.data).toEqual({ question: input.question, expectedAnswer: input.expected, claim: input.claim, answer: "300 mm" });
});

it("asks again when the feedback runs past 20 words", async () => {
  const long = Array.from({ length: 21 }, () => "word").join(" ");
  let replies = 0;
  const tutor = stubTutor(() => ({ result: "right", feedback: replies++ ? "Correct." : long }));
  expect((await gradeShortAnswer(TUTOR_SETTINGS, input)).feedback).toBe("Correct.");
  expect(tutor.calls).toHaveLength(2);
});

it("marks an empty answer wrong without calling the Tutor", async () => {
  const tutor = stubTutor(() => ({ result: "right", feedback: "x" }));
  expect((await gradeShortAnswer(TUTOR_SETTINGS, { ...input, response: "   " })).result).toBe("wrong");
  expect(tutor.calls).toHaveLength(0);
});
