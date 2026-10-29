import "server-only";
import { z } from "zod";
import { chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { STUDY_RESULTS, type StudyResult } from "./levels";

// =====================================================================
// GRADE A SHORT ANSWER: the Tutor compares one answer with the claim the
// question was written from (not with its own knowledge) and returns
// right, partly or wrong with one line of feedback, at most 20 words.
// =====================================================================

export const FEEDBACK_WORDS = 20;
export const MAX_ANSWER_LENGTH = 2000;
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

export const gradeSchema = z.object({
  result: z.enum(STUDY_RESULTS),
  feedback: z.string().trim().min(1).max(200).refine((value) => words(value) <= FEEDBACK_WORDS, `Feedback must be at most ${FEEDBACK_WORDS} words.`),
});

export type GradeInput = { question: string; expected: string; claim: { title: string | null; content: string }; response: string };
export type Grade = { result: StudyResult; feedback: string; usage: TokenUsage };

export async function gradeShortAnswer(settings: TokenFactorySettings, input: GradeInput, options: { instructions?: string; signal?: AbortSignal } = {}): Promise<Grade> {
  const response = input.response.trim().slice(0, MAX_ANSWER_LENGTH);
  // Nothing to grade: no call
  if (!response) return { result: "wrong", feedback: "No answer given.", usage: { tokensIn: 0, tokensOut: 0 } };
  const graded = await chatJson(settings, {
    name: "study_grade", subject: input.question.slice(0, 120), schema: gradeSchema, jsonSchema: z.toJSONSchema(gradeSchema),
    reasoningEffort: "low", maxTokens: 800, retryInvalidOutput: true, signal: options.signal,
    messages: [
      { role: "system", content: options.instructions ?? TUTOR_INSTRUCTIONS },
      { role: "system", content: `Grade the answer against the claim only. Return result (right, partly or wrong) and feedback: one plain sentence of at most ${FEEDBACK_WORDS} words saying what was right or missing.` },
      { role: "user", content: JSON.stringify({ question: input.question, expectedAnswer: input.expected, claim: input.claim, answer: response }) },
    ],
  });
  return { result: graded.value.result, feedback: graded.value.feedback, usage: { tokensIn: graded.tokensIn, tokensOut: graded.tokensOut } };
}
