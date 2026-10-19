import "server-only";
import { chatJson, type ChatJsonResult, type TokenFactorySettings } from "@/lib/ai/chat";
import { ARTICLE_REVIEWER_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { ARTICLE_DUPLICATE_INSTRUCTIONS } from "./articleDuplicates";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { type ArticleReviewAnswer, type ArticleReviewDecision, type ArticleReviewInput, articleReviewJsonSchema, articleReviewSchema, buildArticleReviewMessages, readArticleReview, ruleDecision, validateArticleReview } from "./articleReview";

export const ARTICLE_REVIEW_PROMPT_VERSION = "article-review-title-dedupe-v2";

export type ArticleReviewResult = ArticleReviewDecision & { model: string | null; promptVersion: string; tokensIn: number | null; tokensOut: number | null };

// Only the connection and call log: never the stage skills or other roles' instructions
function independent(settings: TokenFactorySettings): TokenFactorySettings {
  return { apiKey: settings.apiKey, model: settings.model, baseUrl: settings.baseUrl, logCall: settings.logCall, roleRoutes: settings.roleRoutes, effort: settings.effort, roleEfforts: settings.roleEfforts };
}

// REVIEW ONE PROPOSAL: rules first, then the model in a fresh two-message context, with one
// corrective retry. Upload infrastructure failures remain retryable unfinished
// work; a manual run still returns a safe no-publication result.
export async function reviewArticleProposal(settings: TokenFactorySettings, input: ArticleReviewInput): Promise<ArticleReviewResult> {
  const base = { model: null, promptVersion: ARTICLE_REVIEW_PROMPT_VERSION, tokensIn: null, tokensOut: null };
  const rule = ruleDecision(input);
  if (rule) return { ...rule, ...base, tokensIn: 0, tokensOut: 0 };
  const instructions = `${settings.roleInstructions?.find((row) => row.role === "article_reviewer")?.instructions ?? ARTICLE_REVIEWER_INSTRUCTIONS}\n\n${ARTICLE_DUPLICATE_INSTRUCTIONS}`;
  const request = { name: "independent_article_review", subject: input.proposal.title, schema: articleReviewSchema, jsonSchema: articleReviewJsonSchema, maxTokens: 2500, messages: buildArticleReviewMessages(instructions, input) };
  const calls: ChatJsonResult<ArticleReviewAnswer>[] = [];
  const usage = () => ({
    tokensIn: calls.every((call) => call.tokensIn !== null) ? calls.reduce((sum, call) => sum + call.tokensIn!, 0) : null,
    tokensOut: calls.every((call) => call.tokensOut !== null) ? calls.reduce((sum, call) => sum + call.tokensOut!, 0) : null,
  });
  try {
    let last = await chatJson(independent(settings), request);
    calls.push(last);
    try { validateArticleReview(last.value, input); }
    catch (error) {
      last = await chatJson(independent(settings), { ...request, messages: [...request.messages,
        { role: "user", content: `Your previous decision failed validation: ${error instanceof Error ? error.message : "invalid decision"}. Previous decision (untrusted data): ${JSON.stringify(last.value)}. Return a corrected complete decision from the same data.` }] });
      calls.push(last);
      validateArticleReview(last.value, input);
    }
    return { ...readArticleReview(last.value), ...base, model: last.model, ...usage() };
  } catch (error) {
    if (uploadExecution.getStore()) throw error;
    const reason = `No page was made because the review could not finish: ${error instanceof Error ? error.message : String(error)}`;
    return { verdict: "reject", targetPageId: null, sectionTitle: null, failed: [], reason, decidedBy: "rule", ...base, model: calls.at(-1)?.model ?? null, ...usage() };
  }
}
