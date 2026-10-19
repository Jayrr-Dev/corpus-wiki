import "server-only";
import { createHash } from "node:crypto";
import type { DbRpc } from "@/lib/db/rpc";

// ARTICLE JUDGMENTS (supabase/migrations/20261119100000_article_judgments.sql): what
// discovery and scope selection already decided about a claim revision for one
// article. A judgment is reused only for the same revision and the same basis, so
// a revised claim, a new scope or a new prompt version is judged again.
export type JudgmentStage = "discovery" | "scope" | "outline";
export type ArticleJudgment = { stage: JudgmentStage; subject: string; revisionId: string | null; basis: string; decision: string; reason: string };

export const judgmentBasis = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
// Bump a version when its prompt's contract changes, so old decisions are not reused.
export const scopeBasis = (title: string, scope: string | null | undefined) => judgmentBasis("article-scope-v1", title, scope ?? "");
export const discoveryBasis = (title: string, scope: string | null | undefined) => judgmentBasis("article-discovery-v1", title, scope ?? "");
// "Already covered" also depends on the article text that covered it.
export const coveredBasis = (title: string, scope: string | null | undefined, text: string[]) => judgmentBasis("article-discovery-v1", title, scope ?? "", [...text].sort());

// A database without the table judges everything again, as before.
export async function readArticleJudgments(db: DbRpc, pageId: string): Promise<ArticleJudgment[]> {
  try {
    const rows = await db.call<ArticleJudgment[] | null>("read_article_judgments", { p_page_id: pageId });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn("Article judgments unavailable; judging candidates again", { pageId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

// An idempotent memo, not content: losing a save only costs a repeat judgment.
export async function saveArticleJudgments(db: DbRpc, pageId: string, stage: JudgmentStage, judgments: Omit<ArticleJudgment, "stage">[]): Promise<void> {
  if (!judgments.length) return;
  try { await db.call("save_article_judgments", { p_page_id: pageId, p_stage: stage, p_judgments: judgments }); }
  catch (error) { console.warn("Article judgments not saved", { pageId, stage, error: error instanceof Error ? error.message : String(error) }); }
}

// The saved decision for this subject when it still applies to this revision and basis.
export function rememberedJudgment(judgments: ArticleJudgment[], stage: JudgmentStage, subject: string, revisionId: string | null, basis: string): ArticleJudgment | undefined {
  return judgments.find(judgment => judgment.stage === stage && judgment.subject === subject && judgment.revisionId === revisionId && judgment.basis === basis);
}
