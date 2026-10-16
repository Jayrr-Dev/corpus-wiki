import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";
import { ARTICLE_TYPES, type ArticleCharter, type ArticleType } from "./articleCharter";

// =====================================================================
// ARTICLE REVIEWER: before a new article is created, an independent model
// decides whether its subject deserves a page. It reads only the charter,
// the index of existing articles, the proposal's fields and related stored
// knowledge, never the proposer's prompt, history or argument: a proposal
// carries no justification field, so there is nothing to be talked into.
// lib/living-page/runArticleReview.ts makes the call.
// =====================================================================

// Fewer claims than this never make an article; the model is not asked
export const MIN_ARTICLE_CLAIMS = 3;

export type ArticleIndexEntry = { id: string; title: string; type: ArticleType | null; scope: string | null; parentId: string | null; claimCount: number };
export type ArticleProposal = { title: string; type: ArticleType; scope: string; parentPageId: string | null; claims: { ref: string; content: string }[] };
export type RelatedKnowledge = { ref: string; content: string; pageIds: string[] };
export type ArticleReviewInput = { charter: ArticleCharter; articles: ArticleIndexEntry[]; proposal: ArticleProposal; related: RelatedKnowledge[] };

export const ARTICLE_CHECKS = ["distinct", "standalone", "substantive", "inScope", "typeFits"] as const;
export type ArticleCheck = (typeof ARTICLE_CHECKS)[number];

export const articleReviewSchema = z.object({
  checks: z.object({ distinct: z.boolean(), standalone: z.boolean(), substantive: z.boolean(), inScope: z.boolean(), typeFits: z.boolean() }),
  verdict: z.enum(["approve", "update_existing", "section_of", "reject"]),
  targetPageId: z.string().nullable(),
  sectionTitle: z.string().trim().min(1).max(150).nullable(),
  reason: z.string().trim().min(1).max(600),
});
export type ArticleReviewAnswer = z.infer<typeof articleReviewSchema>;
export type ArticleVerdict = ArticleReviewAnswer["verdict"];
export const articleReviewJsonSchema = z.toJSONSchema(articleReviewSchema);

// The decision the pipeline acts on; `decidedBy` says whether a rule or the model made it
export type ArticleReviewDecision = { verdict: ArticleVerdict; targetPageId: string | null; sectionTitle: string | null; failed: ArticleCheck[]; reason: string; decidedBy: "rule" | "model" };

const normalize = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// DECIDED WITHOUT THE MODEL: too few claims, or a title an existing article already has (update that one)
export function ruleDecision(input: ArticleReviewInput): ArticleReviewDecision | null {
  const { proposal, articles } = input;
  if (!ARTICLE_TYPES.includes(proposal.type)) return { verdict: "reject", targetPageId: null, sectionTitle: null, failed: ["typeFits"], reason: `“${proposal.type}” is not an article type.`, decidedBy: "rule" };
  if (proposal.claims.length < MIN_ARTICLE_CLAIMS) {
    return { verdict: "reject", targetPageId: null, sectionTitle: null, failed: ["substantive"], reason: `Only ${proposal.claims.length} claim${proposal.claims.length === 1 ? "" : "s"}; an article needs at least ${MIN_ARTICLE_CLAIMS}.`, decidedBy: "rule" };
  }
  const same = articles.find((article) => normalize(article.title) === normalize(proposal.title));
  if (same) return { verdict: "update_existing", targetPageId: same.id, sectionTitle: null, failed: ["distinct"], reason: `“${same.title}” already exists.`, decidedBy: "rule" };
  return null;
}

// The two messages the reviewer reads: its own instructions, then the data. Nothing else is ever appended.
export function buildArticleReviewMessages(instructions: string, input: ArticleReviewInput): ChatMessage[] {
  const { charter, articles, proposal, related } = input;
  return [
    { role: "system", content: instructions },
    { role: "user", content: JSON.stringify({ charter, articles, proposal, relatedKnowledge: related }) },
  ];
}

// Throws on an answer that contradicts itself or names a page outside the index, so the caller can retry once
export function validateArticleReview(answer: ArticleReviewAnswer, input: ArticleReviewInput): void {
  const failed = ARTICLE_CHECKS.filter((check) => !answer.checks[check]);
  const needsTarget = answer.verdict === "update_existing" || answer.verdict === "section_of";
  if (answer.verdict === "section_of" && !answer.sectionTitle) throw new Error("section_of needs a sectionTitle for the new section.");
  if (answer.verdict !== "section_of" && answer.sectionTitle !== null) throw new Error(`${answer.verdict} takes no sectionTitle; use null.`);
  if (answer.verdict === "approve" && failed.length) throw new Error(`An approval needs every check to pass, but these failed: ${failed.join(", ")}.`);
  if (answer.verdict !== "approve" && !failed.length) throw new Error(`Every check passed, so the verdict must be approve, not ${answer.verdict}.`);
  if (needsTarget && !input.articles.some((article) => article.id === answer.targetPageId)) throw new Error(`${answer.verdict} needs targetPageId to be an id from the article index.`);
  if (!needsTarget && answer.targetPageId !== null) throw new Error(`${answer.verdict} takes no targetPageId; use null.`);
}

// The pipeline's decision from a valid answer
export function readArticleReview(answer: ArticleReviewAnswer): ArticleReviewDecision {
  return { verdict: answer.verdict, targetPageId: answer.targetPageId, sectionTitle: answer.sectionTitle, failed: ARTICLE_CHECKS.filter((check) => !answer.checks[check]), reason: answer.reason, decidedBy: "model" };
}

// ORCHESTRATION: what the pipeline does next for a reviewed proposal. The reviewer
// routes the work; it never writes. Updating an existing article is preferred over a new one.
export type ArticleNextStep =
  | { kind: "create_article"; proposal: ArticleProposal }
  | { kind: "update_article"; pageId: string; claimRefs: string[] }
  | { kind: "add_section"; pageId: string; title: string; claimRefs: string[] }
  | { kind: "none"; claimRefs: string[] };

export function nextStep(decision: ArticleReviewDecision, proposal: ArticleProposal): ArticleNextStep {
  const claimRefs = proposal.claims.map((claim) => claim.ref);
  switch (decision.verdict) {
    case "approve": return { kind: "create_article", proposal };
    case "update_existing": return decision.targetPageId ? { kind: "update_article", pageId: decision.targetPageId, claimRefs } : { kind: "none", claimRefs };
    case "section_of": return decision.targetPageId && decision.sectionTitle ? { kind: "add_section", pageId: decision.targetPageId, title: decision.sectionTitle, claimRefs } : { kind: "none", claimRefs };
    case "reject": return { kind: "none", claimRefs };
  }
}
