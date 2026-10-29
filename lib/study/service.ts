import "server-only";
import { z } from "zod";
import { tokenFactoryFromEnv, type TokenFactorySettings } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import type { DbRpc } from "@/lib/db/rpc";
import { type CoverageChoice, coverageShare, isCustomChoice, loadScopeClaims, MAX_CUSTOM_CLAIMS, pickCoverage, type Scope, type ScopeClaim } from "@/lib/knowledge/scope";
import { type GeneratedItem, generateStudyItems, shuffle } from "./generate";
import { gradeShortAnswer, MAX_ANSWER_LENGTH } from "./grade";
import { type ClaimProgress, nextProgress, type StudyResult } from "./levels";
import { type AnswerOutcome, CHOICE_COUNT, STUDY_KINDS, type StudyItemWithClaim, type StudyKind, type StudySetsData } from "./types";

// =====================================================================
// STUDY SERVICE: what the /api/study routes and the study pages do.
// Build a set from a scope, answer a question (the Tutor grades short
// answers), and rebuild questions whose claim has a newer revision.
// Every database call goes through the study functions (DbRpc), and the
// Tutor and scope loader are passed in, so tests run without either.
// =====================================================================

// A set covers at most this many claims (each one costs a share of a Tutor call per question type)
export const MAX_SET_CLAIMS = 100;

export type Tutor = { settings: TokenFactorySettings; instructions: string };
export type StudyDeps = {
  db: DbRpc;
  // The Tutor's model and instructions, read when a call needs them
  tutor: () => Promise<Tutor>;
  loadClaims: (scope: Scope) => Promise<ScopeClaim[]>;
  now: () => Date;
};

// The Tutor as picked in Settings → Model by role (or the active model), with its Agent Roles instructions
export async function readTutor(db: DbRpc): Promise<Tutor> {
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "tutor" } }));
  if (!settings) throw new Error("Configure an AI provider in Settings before building study sets.");
  const instructions = (await loadRoleInstructions(db)).find((row) => row.role === "tutor")?.instructions ?? TUTOR_INSTRUCTIONS;
  return { settings, instructions };
}

export function studyDeps(db: DbRpc): StudyDeps {
  return { db, tutor: () => readTutor(db), loadClaims: (scope) => loadScopeClaims(scope), now: () => new Date() };
}

// ---------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------

// Sets with items, claims and the person's levels; items whose claim changed are marked stale first
export async function readStudySets(db: DbRpc, userId: string, setId: string | null = null): Promise<StudySetsData> {
  await db.call("mark_stale_study_items", { p_set_id: setId });
  return db.call<StudySetsData>("read_study_sets", { p_user_id: userId, p_set_id: setId });
}

// ---------------------------------------------------------------------
// NEW SET
// ---------------------------------------------------------------------

const uuid = z.uuid();
export const newSetSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.enum(["topic", "article", "entity"]), id: uuid }),
    z.object({ kind: z.literal("glossary"), id: uuid.nullish() }),
  ]),
  // a share of the scope's claims, or the claims the person checked (Custom)
  coverage: z.union([z.literal(25), z.literal(50), z.literal(100), z.object({ custom: z.array(uuid).min(1).max(MAX_CUSTOM_CLAIMS) })]),
  types: z.array(z.enum(STUDY_KINDS)).min(1).max(3).transform((types) => STUDY_KINDS.filter((kind) => types.includes(kind))),
  // open the set with the newest video made from its source
  introVideo: z.boolean().default(false),
});
export type NewSetInput = z.infer<typeof newSetSchema>;

// The claims a set is written from: the scope's most central claims at the chosen coverage
export function setClaims(claims: readonly ScopeClaim[], coverage: CoverageChoice): ScopeClaim[] {
  return pickCoverage(claims, coverage).slice(0, MAX_SET_CLAIMS);
}

// BUILD A SET: saves the set, then each batch of questions as the Tutor writes it
export async function createStudySet(deps: StudyDeps, userId: string, input: NewSetInput, onProgress?: (done: number, total: number) => void): Promise<{ id: string; items: number }> {
  const scope = input.scope;
  const scoped = await deps.loadClaims(scope);
  const claims = setClaims(scoped, input.coverage);
  if (!claims.length) throw new Error("This source has no claims to study yet.");
  const tutor = await deps.tutor();
  const id = await deps.db.call<string>("create_study_set", {
    p_title: input.title, p_scope_kind: scope.kind, p_scope_id: scope.id ?? null,
    p_coverage: coverageShare(input.coverage), p_types: input.types, p_user_id: userId,
    // sent only when asked for, so sets still save on a database without the column
    ...(input.introVideo ? { p_intro_video: true } : {}),
    // the checked claims, kept only for a Custom set
    ...(isCustomChoice(input.coverage) ? { p_claim_ids: input.coverage.custom } : {}),
  });
  const { items } = await generateStudyItems(tutor.settings, claims, input.types, {
    instructions: tutor.instructions, siblings: scoped, onProgress,
    onBatch: (batch) => deps.db.call("add_study_items", { p_set_id: id, p_items: batch }),
  });
  return { id, items: items.length };
}

// ---------------------------------------------------------------------
// ANSWER
// ---------------------------------------------------------------------

export const answerSchema = z.object({
  itemId: uuid,
  // Flashcards: Got it (right) or Again (wrong)
  result: z.enum(["right", "wrong"]).optional(),
  // Multiple choice: the option picked; short answer: the text written
  response: z.string().max(MAX_ANSWER_LENGTH).optional(),
});
export type AnswerInput = z.infer<typeof answerSchema>;

// The result of one answer: the person says for flashcards, the stored answer decides multiple choice,
// and the Tutor grades short answers against the claim
async function judge(deps: StudyDeps, item: StudyItemWithClaim, input: AnswerInput): Promise<{ result: StudyResult; feedback: string | null }> {
  if (item.kind === "flashcard") {
    if (!input.result) throw new Error("Say whether you got it.");
    return { result: input.result, feedback: null };
  }
  const response = input.response?.trim() ?? "";
  if (item.kind === "multiple_choice") return { result: response === item.answer.trim() ? "right" : "wrong", feedback: null };
  const tutor = await deps.tutor();
  const grade = await gradeShortAnswer(tutor.settings, { question: item.prompt, expected: item.answer, claim: item.claim, response }, { instructions: tutor.instructions });
  return { result: grade.result, feedback: grade.feedback };
}

// ANSWER ONE QUESTION: records the attempt and moves the claim's level and next review (lib/study/levels.ts)
export async function answerItem(deps: StudyDeps, userId: string, input: AnswerInput, timeZone = "UTC"): Promise<AnswerOutcome> {
  const item = await deps.db.call<StudyItemWithClaim | null>("read_study_item", { p_item_id: input.itemId });
  if (!item) throw new Error("This question was removed.");
  const { result, feedback } = await judge(deps, item, input);
  const previous = await deps.db.call<ClaimProgress | null>("read_study_progress", { p_user_id: userId, p_unit_id: item.unitId });
  const progress = nextProgress(previous, result, deps.now(), timeZone);
  await deps.db.call("record_study_attempt", { p_item_id: item.id, p_user_id: userId, p_response: input.response ?? (input.result ?? ""), p_result: result, p_feedback: feedback, p_progress: progress });
  return { result, feedback, progress: { ...progress, unitId: item.unitId } };
}

// ---------------------------------------------------------------------
// REBUILD
// ---------------------------------------------------------------------

type Rebuildable = Pick<StudyItemWithClaim, "id" | "unitId" | "kind">;

// Writes a new question for each item from its claim's current revision; claims that were retired are skipped
async function rewrite(deps: StudyDeps, items: readonly Rebuildable[], siblings: readonly ScopeClaim[]): Promise<{ rebuilt: number; retired: number }> {
  if (!items.length) return { rebuilt: 0, retired: 0 };
  const current = await deps.db.call<ScopeClaim[]>("read_study_claims", { p_unit_ids: [...new Set(items.map((item) => item.unitId))] });
  const claims = new Map(current.map((claim) => [claim.unitId, claim]));
  const tutor = await deps.tutor();
  let rebuilt = 0;
  for (const kind of STUDY_KINDS) {
    const ofKind = items.filter((item) => item.kind === kind && claims.has(item.unitId));
    if (!ofKind.length) continue;
    const { items: written } = await generateStudyItems(tutor.settings, [...new Set(ofKind.map((item) => item.unitId))].map((unitId) => claims.get(unitId)!), [kind as StudyKind], { instructions: tutor.instructions, siblings: siblings.length ? siblings : current });
    const byClaim = new Map<string, GeneratedItem>(written.map((item) => [item.unitId, item]));
    for (const item of ofKind) {
      const replacement = byClaim.get(item.unitId);
      if (!replacement) continue;
      await deps.db.call("replace_study_item", { p_item_id: item.id, p_item: replacement });
      rebuilt++;
    }
  }
  return { rebuilt, retired: items.filter((item) => !claims.has(item.unitId)).length };
}

// The other claims a set tests, as material for wrong options
async function setSiblings(deps: StudyDeps, setId: string, userId: string): Promise<ScopeClaim[]> {
  const data = await deps.db.call<StudySetsData>("read_study_sets", { p_user_id: userId, p_set_id: setId });
  return deps.db.call<ScopeClaim[]>("read_study_claims", { p_unit_ids: data.claims.map((claim) => claim.unitId) });
}

// REGENERATE (Questions tab): a new question for one item, from its claim's current revision
export async function regenerateItem(deps: StudyDeps, userId: string, itemId: string): Promise<void> {
  const item = await deps.db.call<StudyItemWithClaim | null>("read_study_item", { p_item_id: itemId });
  if (!item) throw new Error("This question was removed.");
  const { rebuilt, retired } = await rewrite(deps, [item], await setSiblings(deps, item.setId, userId));
  if (retired) throw new Error("Its claim was retired. Remove this question instead.");
  if (!rebuilt) throw new Error("The Tutor did not write a new question. Try again.");
}

// REBUILD STALE QUESTIONS when a set is opened: every item whose claim has a newer revision
export async function rebuildStaleItems(deps: StudyDeps, userId: string, setId: string): Promise<{ rebuilt: number; retired: number }> {
  await deps.db.call("mark_stale_study_items", { p_set_id: setId });
  const data = await deps.db.call<StudySetsData>("read_study_sets", { p_user_id: userId, p_set_id: setId });
  const stale = data.items.filter((item) => item.stale);
  if (!stale.length) return { rebuilt: 0, retired: 0 };
  return rewrite(deps, stale, await deps.db.call<ScopeClaim[]>("read_study_claims", { p_unit_ids: data.claims.map((claim) => claim.unitId) }));
}

export async function removeItem(db: DbRpc, itemId: string): Promise<void> {
  await db.call("remove_study_item", { p_item_id: itemId });
}

// ---------------------------------------------------------------------
// EDIT (admin mode): rename a set, delete a set, edit a question's text, add a question by hand
// ---------------------------------------------------------------------

export const setTitleSchema = z.object({ title: z.string().trim().min(1).max(200) });
export const questionTextSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
export const newQuestionSchema = z.object({
  // a claim already in the set
  unitId: uuid,
  kind: z.enum(STUDY_KINDS),
  prompt: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(2000),
  // multiple choice only: the three wrong options (the answer is added to them)
  wrongChoices: z.array(z.string().trim().min(1).max(300)).max(CHOICE_COUNT - 1).default([]),
});
export type NewQuestionInput = z.infer<typeof newQuestionSchema>;

export async function renameSet(db: DbRpc, setId: string, title: string): Promise<void> {
  await db.call("rename_study_set", { p_set_id: setId, p_title: title });
}

// DELETE A SET: its questions and their answers go too; the person's levels on the claims stay
export async function deleteSet(db: DbRpc, setId: string): Promise<void> {
  await db.call("delete_study_set", { p_set_id: setId });
}

export async function editQuestionText(db: DbRpc, itemId: string, prompt: string): Promise<void> {
  await db.call("update_study_item_prompt", { p_item_id: itemId, p_prompt: prompt });
}

// ADD A QUESTION BY HAND: on a claim already in the set, written from the claim's current revision
export async function addQuestionByHand(db: DbRpc, userId: string, setId: string, input: NewQuestionInput): Promise<void> {
  const data = await db.call<StudySetsData>("read_study_sets", { p_user_id: userId, p_set_id: setId });
  if (!data.sets.length) throw new Error("This set was removed.");
  const claim = data.claims.find((row) => row.unitId === input.unitId);
  if (!claim || claim.retired) throw new Error("Pick a claim that is in this set.");
  const [current] = await db.call<ScopeClaim[]>("read_study_claims", { p_unit_ids: [input.unitId] });
  if (!current) throw new Error("This claim was retired.");
  let choices: string[] | null = null;
  if (input.kind === "multiple_choice") {
    if (input.wrongChoices.length !== CHOICE_COUNT - 1) throw new Error("Multiple choice needs three wrong options.");
    const key = (value: string) => value.trim().toLowerCase();
    if (new Set([input.answer, ...input.wrongChoices].map(key)).size !== CHOICE_COUNT) throw new Error("Each option must be different from the others.");
    choices = shuffle([input.answer, ...input.wrongChoices]);
  }
  await db.call("add_study_items", { p_set_id: setId, p_items: [{ unitId: input.unitId, revisionId: current.revisionId, kind: input.kind, prompt: input.prompt, answer: input.answer, choices, explanation: "" }] });
}
