// =====================================================================
// ARTICLE CHARTER: what this wiki is for, who reads it, and what never
// gets an article. One workspace setting (workspace_settings.article_charter),
// edited on /settings and read by the Article Reviewer, so which subjects
// earn a page follows the person's purpose instead of the topic tree.
// =====================================================================

export type ArticleCharter = { purpose: string; audience: string; outOfScope: string };

export const EMPTY_CHARTER: ArticleCharter = { purpose: "", audience: "", outOfScope: "" };
export const CHARTER_FIELD_MAX = 1000;

// ARTICLE TYPES: every article is exactly one of these
export const ARTICLE_TYPES = ["entity", "process", "requirement", "concept"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

// The stored value as a full charter: unknown keys and non-text values dropped, text trimmed
export function readCharter(value: unknown): ArticleCharter {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: keyof ArticleCharter) => (typeof row[key] === "string" ? (row[key] as string).trim() : "");
  return { purpose: text("purpose"), audience: text("audience"), outOfScope: text("outOfScope") };
}

// True once the charter says what the wiki is for; without a purpose there is nothing to judge scope against
export function hasCharter(charter: ArticleCharter): boolean {
  return charter.purpose.length > 0;
}
