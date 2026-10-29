import type { Coverage, ScopeKind } from "@/lib/knowledge/scopeTypes";
import type { ClaimProgress } from "./levels";

// =====================================================================
// STUDY TYPES: what the study tables hold (supabase/migrations/
// 20261120100000_study.sql), as the read functions return them. Shared by
// the server (lib/study) and the screens (app/(app)/study).
// =====================================================================

export const STUDY_KINDS = ["flashcard", "multiple_choice", "short_answer"] as const;
export type StudyKind = (typeof STUDY_KINDS)[number];
export const STUDY_KIND_LABELS: Record<StudyKind, string> = { flashcard: "Flashcard", multiple_choice: "Multiple choice", short_answer: "Short answer" };
export const isStudyKind = (value: unknown): value is StudyKind => (STUDY_KINDS as readonly unknown[]).includes(value);

// Multiple choice always offers four options
export const CHOICE_COUNT = 4;

// `custom`: the claims were checked by hand, so `coverage` is not the share used
export type StudySetRow = { id: string; title: string; scopeKind: ScopeKind; scopeId: string | null; coverage: Coverage; custom: boolean; types: StudyKind[]; introVideo: boolean; createdAt: string };

// One question on one claim; revisionId is the claim revision it was written from
export type StudyItemRow = {
  id: string; setId: string; unitId: string; revisionId: string; kind: StudyKind;
  prompt: string; answer: string; choices: string[] | null; explanation: string; stale: boolean;
};

// A claim a set tests, as its current revision
export type StudyClaim = { unitId: string; title: string | null; content: string; retired: boolean };

export type StudyProgressRow = ClaimProgress & { unitId: string };

// read_study_sets: sets with their items, claims and one person's levels
export type StudySetsData = { sets: StudySetRow[]; items: StudyItemRow[]; claims: StudyClaim[]; progress: StudyProgressRow[] };

// read_study_item: an item with the claim revision it was written from
export type StudyItemWithClaim = StudyItemRow & { claim: { title: string | null; content: string } };

// What the person sees after answering
export type AnswerOutcome = { result: "right" | "partly" | "wrong"; feedback: string | null; progress: StudyProgressRow };
