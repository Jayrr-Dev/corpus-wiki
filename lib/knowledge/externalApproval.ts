import "server-only";
import { REVIEWER_INSTRUCTIONS, RESEARCH_SEARCH_INSTRUCTIONS, RESEARCH_SOURCE_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";

export type ExternalProjectContext = {
  organization: string | null;
  article: string;
  section: string;
  sourceTitles: string[];
  projectFacts: string[];
  existingKnowledge: string[];
};
export type ResearchProposal = { needed: boolean; gap: string; justification: string; query: string };
export type ExternalReview = {
  stage: "search" | "source"; outcome: "approved" | "rejected" | "error";
  context: ExternalProjectContext; proposal: object; reason: string;
  url: string | null; sourceTitle: string | null; excerpts: string[]; model: string | null;
  attribution?: { proposedBy: { role: string; model: string | null }; decidedBy: { role: string; model: string | null }; instructions: { proposer: string; reviewer: string }; version: number };
  tokensIn?: number | null; tokensOut?: number | null;
};
export type ReviewRecorder = (review: ExternalReview) => Promise<string>;
const proposalSchema = z.object({ needed: z.boolean(), gap: z.string().max(1500), justification: z.string().max(2000), query: z.string().max(200) });
const decisionSchema = z.object({ approved: z.boolean(), reason: z.string().trim().min(1).max(3000) });
const sourceProposalSchema = z.object({ justification: z.string().trim().min(1).max(2000), excerpts: z.array(z.string().max(4000)).max(8) });
const sourceDecisionSchema = decisionSchema.extend({ excerptIndices: z.array(z.number().int().nonnegative()).max(8) });

// This reviewer has its own role policy and a fresh two-message context. Never
// append stage skills, researcher prompts, agent history or editorial instructions.


function independent(settings: TokenFactorySettings): TokenFactorySettings {
  return { apiKey: settings.apiKey, model: settings.model, baseUrl: settings.baseUrl, logCall: settings.logCall };
}

// Include every provider attempt, including retries and failed responses.
function trackUsage(settings: TokenFactorySettings) {
  const total = { tokensIn: 0 as number | null, tokensOut: 0 as number | null };
  let calls = 0;
  return {
    total,
    get calls() { return calls; },
    settings: { ...settings, logCall: async (call: Parameters<NonNullable<TokenFactorySettings["logCall"]>>[0]) => {
      calls++;
      total.tokensIn = total.tokensIn === null || call.promptTokens === null ? null : total.tokensIn + call.promptTokens;
      total.tokensOut = total.tokensOut === null || call.completionTokens === null ? null : total.tokensOut + call.completionTokens;
      await settings.logCall?.(call);
    } },
  };
}

export async function approveExternalSearch(settings: TokenFactorySettings, context: ExternalProjectContext, note: string, record: ReviewRecorder): Promise<ResearchProposal | null> {
  const researcherInstructions = settings.roleInstructions?.find((row) => row.role === "researcher")?.instructions;
  const reviewerInstructions = settings.roleInstructions?.find((row) => row.role === "reviewer")?.instructions ?? REVIEWER_INSTRUCTIONS;
  const tracked = trackUsage(settings);
  settings = tracked.settings;
  const usage = { tokensIn: 0 as number | null, tokensOut: 0 as number | null };
  let proposerModel: string | null = null;
  const save: ReviewRecorder = (review) => record({ ...review, ...(tracked.calls ? tracked.total : usage), attribution: {
    proposedBy: { role: "researcher", model: proposerModel }, decidedBy: { role: "reviewer", model: review.model },
    instructions: { proposer: researcherInstructions ?? (review.stage === "search" ? RESEARCH_SEARCH_INSTRUCTIONS : RESEARCH_SOURCE_INSTRUCTIONS), reviewer: reviewerInstructions }, version: 1,
  } });
  let proposal: ResearchProposal = { needed: false, gap: "", justification: "", query: "" };
  const review = { stage: "search" as const, context, url: null, sourceTitle: null, excerpts: [] };
  try {
    if (!context.projectFacts.length) {
      await save({ ...review, proposal, outcome: "rejected", reason: "No internally sourced project context is available to justify outside research.", model: null });
      return null;
    }
    const proposed = await chatJson(settings, {
      name: "external_research_justification", subject: context.article, schema: proposalSchema, jsonSchema: z.toJSONSchema(proposalSchema), maxTokens: 2500,
      messages: [{ role: "system", content: researcherInstructions ?? RESEARCH_SEARCH_INSTRUCTIONS }, { role: "user", content: JSON.stringify({ context, note }) }],
    });
    proposerModel = proposed.model;
    usage.tokensIn = proposed.tokensIn; usage.tokensOut = proposed.tokensOut;
    proposal = proposed.value;
    const decision = await chatJson(independent(settings), {
      name: "independent_external_search_approval", subject: context.article, schema: decisionSchema, jsonSchema: z.toJSONSchema(decisionSchema), maxTokens: 2500,
      messages: [{ role: "system", content: reviewerInstructions }, { role: "user", content: JSON.stringify({ context, proposal }) }],
    });
    usage.tokensIn = usage.tokensIn === null || decision.tokensIn === null ? null : usage.tokensIn + decision.tokensIn;
    usage.tokensOut = usage.tokensOut === null || decision.tokensOut === null ? null : usage.tokensOut + decision.tokensOut;
    const actionable = proposal.needed && Boolean(proposal.query.trim() && proposal.gap.trim() && proposal.justification.trim());
    const approved = decision.value.approved && actionable;
    await save({ ...review, proposal, reason: decision.value.approved && !actionable ? `${decision.value.reason} No search was authorized because the proposal supplied no actionable query, gap, or justification.` : decision.value.reason, outcome: approved ? "approved" : "rejected", model: decision.model });
    return approved ? proposal : null;
  } catch (error) {
    if (!tracked.calls) { usage.tokensIn = null; usage.tokensOut = null; }
    await save({ ...review, proposal, outcome: "error", reason: error instanceof Error ? error.message : String(error), model: null });
    return null;
  }
}

export async function approveExternalSource(settings: TokenFactorySettings, context: ExternalProjectContext, research: ResearchProposal, source: { title: string; url: string; text: string }, record: ReviewRecorder): Promise<{ text: string; reviewId: string } | null> {
  const researcherInstructions = settings.roleInstructions?.find((row) => row.role === "researcher")?.instructions;
  const reviewerInstructions = settings.roleInstructions?.find((row) => row.role === "reviewer")?.instructions ?? REVIEWER_INSTRUCTIONS;
  const tracked = trackUsage(settings);
  settings = tracked.settings;
  const usage = { tokensIn: 0 as number | null, tokensOut: 0 as number | null };
  let proposerModel: string | null = null;
  const save: ReviewRecorder = (review) => record({ ...review, ...(tracked.calls ? tracked.total : usage), attribution: {
    proposedBy: { role: "researcher", model: proposerModel }, decidedBy: { role: "reviewer", model: review.model },
    instructions: { proposer: researcherInstructions ?? (review.stage === "search" ? RESEARCH_SEARCH_INSTRUCTIONS : RESEARCH_SOURCE_INSTRUCTIONS), reviewer: reviewerInstructions }, version: 1,
  } });
  let proposal: object = research;
  let excerpts: string[] = [];
  const review = { stage: "source" as const, context, url: source.url, sourceTitle: source.title };
  try {
    const proposed = await chatJson(settings, {
      name: "external_source_justification", subject: source.title, schema: sourceProposalSchema, jsonSchema: z.toJSONSchema(sourceProposalSchema), maxTokens: 5000,
      messages: [{ role: "system", content: researcherInstructions ?? RESEARCH_SOURCE_INSTRUCTIONS }, { role: "user", content: JSON.stringify({ context, research, source }) }],
    });
    proposerModel = proposed.model;
    usage.tokensIn = proposed.tokensIn; usage.tokensOut = proposed.tokensOut;
    excerpts = [...new Set(proposed.value.excerpts.map((text) => text.trim()).filter((text) => text.length > 30 && source.text.includes(text)))];
    proposal = { research, justification: proposed.value.justification };
    const decision = await chatJson(independent(settings), {
      name: "independent_external_source_approval", subject: source.title, schema: sourceDecisionSchema, jsonSchema: z.toJSONSchema(sourceDecisionSchema), maxTokens: 3000,
      messages: [{ role: "system", content: reviewerInstructions }, { role: "user", content: JSON.stringify({ context, proposal, source: { title: source.title, url: source.url, text: source.text, excerpts } }) }],
    });
    usage.tokensIn = usage.tokensIn === null || decision.tokensIn === null ? null : usage.tokensIn + decision.tokensIn;
    usage.tokensOut = usage.tokensOut === null || decision.tokensOut === null ? null : usage.tokensOut + decision.tokensOut;
    const selected = [...new Set(decision.value.excerptIndices)].flatMap((index) => excerpts[index] ?? []);
    const approved = decision.value.approved && selected.length > 0;
    const reviewId = await save({ ...review, proposal, excerpts: approved ? selected : excerpts, outcome: approved ? "approved" : "rejected", reason: decision.value.approved && !selected.length ? "The approver selected no valid evidence to admit." : decision.value.reason, model: decision.model });
    return approved ? { text: selected.join("\n\n"), reviewId } : null;
  } catch (error) {
    if (!tracked.calls) { usage.tokensIn = null; usage.tokensOut = null; }
    await save({ ...review, proposal, excerpts, outcome: "error", reason: error instanceof Error ? error.message : String(error), model: null });
    return null;
  }
}
