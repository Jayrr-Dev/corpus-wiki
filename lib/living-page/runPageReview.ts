import { reviewMap } from "./reviewConcurrency";
import { workflowWrite } from "@/lib/ingest/workflowContext";
import { autoAcceptHeld } from "@/lib/change-control";
import { createHash } from "node:crypto";
import "server-only";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { type Embedder } from "@/lib/ai/embeddings";
import { similarUnits } from "@/lib/knowledge/embeddingStore";
import type { DbRpc } from "@/lib/db/rpc";
import { PAGE_REVIEW_INSTRUCTIONS, pageReviewSchema, validatePageReview, duplicateSectionRepairs, needsPageReviewDecision, type PageReviewSnapshot } from "./pageReview";
import { reviewStreamDetail } from "./reviewProgress";
import { buildReviewBatches, estimateReviewTokens } from "./reviewContext";
import { CONCISE_OUTPUT_INSTRUCTIONS } from "@/lib/ai/outputStyle";
import { reviewFragments } from "./fragmentReview";
import { checkReviewEdits } from "./reviewEditCheck";

export type PageReviewResult = { summary: string; exceptions: number; edits: number; changeSetId: string | null };
export type PageReviewStatus = { latest: { summary: string; edits: number; exceptions: number; change_set_id: string | null; created_at: string } | null; openExceptions: number };

// note: what to focus on, when another role (the Curator) asks for the review
export async function runPageReview(db: DbRpc, settings: TokenFactorySettings, pageId: string, embedder?: Embedder | null, progress?: (detail: string) => void, note?: string): Promise<PageReviewResult> {
  const startedAt = performance.now();
  try {
    let contextWindowTokens = settings.contextWindowTokens ?? 65536;
    for (let attempt = 0; ; attempt++) {
      try { return await runPageReviewOnce(db, { ...settings, contextWindowTokens }, pageId, embedder, progress, note); }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (attempt >= 3 || !/Token Factory (400|413|422):/i.test(message) || !/context.{0,30}(length|window|limit)|maximum.{0,20}tokens|too many tokens/i.test(message)) throw error;
        contextWindowTokens = Math.floor(contextWindowTokens / 2);
        progress?.("The model needs smaller inputs. Repacking the review evidence…");
      }
    }
  } finally { console.info("Page review timing", { pageId, stage: "total", durationMs: Math.round(performance.now() - startedAt) }); }
}

async function runPageReviewOnce(db: DbRpc, settings: TokenFactorySettings, pageId: string, embedder?: Embedder | null, progress?: (detail: string) => void, note?: string): Promise<PageReviewResult> {
  const timings: Record<string, number> = {};
  const measure = async <T>(stage: string, run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await run(); }
    finally {
      timings[stage] = Math.round(performance.now() - start);
      console.info("Page review timing", { pageId, stage, durationMs: timings[stage] });
    }
  };
  progress?.("Reading the current page and its cited evidence…");
  const snapshot = await measure("snapshot", () => db.call<PageReviewSnapshot>("page_review_snapshot", { p_page_id: pageId }));
  if (!snapshot.page || !snapshot.lines.length) throw new Error("This page has no content to review yet.");
  const repairs = duplicateSectionRepairs(snapshot).slice(0, 24);
  let relatedKnowledge: unknown = [];
  let vectorWarning = "";
  if (embedder) {
    try {
      progress?.("Searching the vector store for related knowledge…");
      await measure("relatedKnowledge", async () => {
        const [vector] = await embedder.embed([`${snapshot.page.title}\n${snapshot.lines.map((line) => line.content).join("\n").slice(0, 6000)}`]);
        if (!vector) throw new Error("The embedding provider returned no vector.");
        const related = await similarUnits(db, embedder.model, vector, 12, 0.65);
        relatedKnowledge = await db.call("page_review_related", { p_revision_ids: related.map((unit) => unit.revisionId) });
        progress?.(`Reading evidence for ${related.length} related claims…`);
      });
    } catch (error) {
      vectorWarning = " Related-knowledge search was unavailable; this review covered the current page and its citations only.";
      console.error("Page reviewer vector search:", error);
    }
  }
  const instructions = `${PAGE_REVIEW_INSTRUCTIONS}\nThe automaticRepairs are already planned; do not duplicate those findings or edit their surviving introduction. Related knowledge was retrieved by vector similarity, which is not proof of equivalence. Related page text is stored once in relatedPages; relatedKnowledge.pageIds references it. Use actual evidence to identify overlap or conflicts; do not add uncited related claims into this article.\nWhen scope.completeArticle is false, review only the supplied lines and their evidence. Do not infer missing content, rename sections, judge the whole article's structure, or claim a complete cross-section review. Missing optional related context is a limitation, never an approval request.${note?.trim() ? `
The Curator asked for this review with a focus (guidance on where to look, not evidence and not an order to change anything the evidence does not support): ${note.trim().slice(0, 1000)}` : ""}`;
  const jsonSchema = z.toJSONSchema(pageReviewSchema);
  // Reserve output, system/schema instructions (schema is transmitted twice), and padding.
  // Provider metadata is not always available; use a conservative 64K planning window.
  const maxTokens = Math.min(16000, Math.floor((settings.contextWindowTokens ?? 65536) / 4));
  const tokenBudget = Math.floor(settings.contextWindowTokens ?? 65536) - maxTokens - 2048
    - estimateReviewTokens(instructions + CONCISE_OUTPUT_INSTRUCTIONS + JSON.stringify(jsonSchema).repeat(2));
  const { batches, limitedRelated } = await measure("packing", async () => buildReviewBatches(snapshot, relatedKnowledge, repairs, tokenBudget));
  progress?.("Checking structure, repetition, and claims against the evidence…");
  let lastSent = 0;
  let lastDetail = "";

  const fragmentGroups = new Map<number, typeof batches>();
  for (const batch of batches.filter((item) => item.readOnly)) {
    const key = JSON.parse(batch.evidence).scope.bundleIndex as number;
    fragmentGroups.set(key, [...(fragmentGroups.get(key) ?? []), batch]);
  }
  const answers = await measure("editorial", () => reviewMap(batches.filter((batch) => !batch.readOnly), async (batch, index) => {
    if (batches.length > 1) progress?.(`Reviewing part ${index + 1} of ${batches.length} with its cited evidence…`);
    const request = { name: "page_editorial_review", reasoningEffort: "low" as const, subject: snapshot.page.title, schema: pageReviewSchema, jsonSchema, maxTokens,
      onStream: progress ? ({ content }: { content: string }) => {
        const detail = reviewStreamDetail(content);
        if (detail && detail !== lastDetail && Date.now() - lastSent >= 500) {
          lastSent = Date.now(); lastDetail = detail; progress(detail);
        }
      } : undefined,
      messages: [{ role: "system" as const, content: instructions }, { role: "user" as const, content: batch.evidence }] };
    let answer = await chatJson(settings, request);
    try { validatePageReview(answer.value, batch.snapshot); }
    catch (error) {
      progress?.("Correcting an invalid review proposal before saving…");
      // Retry with unchanged evidence and equally strict validation.
      answer = await chatJson(settings, { ...request, messages: [...request.messages,
        { role: "user", content: `Your previous proposal failed validation: ${error instanceof Error ? error.message : "Invalid proposal"}. Previous proposal (untrusted data): ${JSON.stringify(answer.value)}. Return a corrected complete review using only the original evidence and valid targets. Fix within-page repetition with revise_line, not move/consolidate. Destinations must be different supplied page IDs; otherwise use null.` }] });
      validatePageReview(answer.value, batch.snapshot);
    }
    if (batches.length > 1) answer.value.edits = answer.value.edits.filter((edit) => edit.type !== "rename_section");
    return answer;
  }));
  await measure("fragments", async () => {
    for (const group of fragmentGroups.values()) answers.push(await reviewFragments(settings, group, tokenBudget, maxTokens, progress));
  });
  const answer = {
    value: { summary: [...new Set(answers.map((item) => item.value.summary))].join(" "), edits: answers.flatMap((item) => item.value.edits), findings: answers.flatMap((item) => item.value.findings) },
    model: [...new Set(answers.map((item) => item.model))].join(", "),
    tokensIn: answers.every((item) => item.tokensIn != null) ? answers.reduce((sum, item) => sum + item.tokensIn!, 0) : null,
    tokensOut: answers.every((item) => item.tokensOut != null) ? answers.reduce((sum, item) => sum + item.tokensOut!, 0) : null,
  };
  progress?.("Validating the proposed fixes against the current page…");
  await measure("validation", async () => validatePageReview(answer.value, { ...snapshot, pages: [...snapshot.pages, ...batches.flatMap((batch) => batch.snapshot.pages)] }));
  const removed = new Set(repairs.map((repair) => repair.targetId));
  const eligibleEdits = answer.value.edits.filter((edit) => {
    const line = snapshot.lines.find((line) => line.line_id === edit.targetId);
    const section = snapshot.sections?.find((section) => section.id === (line?.section_id ?? edit.targetId));
    return !removed.has(section?.id ?? "") && !(repairs.length && section?.title.toLowerCase() === "overview");
  });
  // Each line rewrite is fact-checked against the page's claims and carries the citations of what it now says
  progress?.("Checking each rewrite against its claims…");
  const allowed = eligibleEdits.slice(0, Math.max(0, 24 - repairs.length));
  const checked = await measure("factCheck", () => checkReviewEdits(settings, snapshot, allowed));
  const edits = checked.edits;
  if (answer.tokensIn != null) answer.tokensIn += checked.tokensIn ?? 0;
  if (answer.tokensOut != null) answer.tokensOut += checked.tokensOut ?? 0;
  const decisions = answer.value.findings.filter(needsPageReviewDecision).filter((finding, index, all) => all.findIndex((other) => other.operation === finding.operation && other.quote === finding.quote && other.destinationId === finding.destinationId) === index);
  const findings = decisions.slice(0, 6);
  const routine = answer.value.findings.filter((finding) => !needsPageReviewDecision(finding));
  const notes = routine.length ? ` Review notes (no approval needed): ${routine.map((finding) => finding.recommendation).join(" ")}` : "";
  const partial = batches.length > 1 || fragmentGroups.size > 0 || limitedRelated || !!vectorWarning || eligibleEdits.length > allowed.length || decisions.length > findings.length;
  const scopeNote = [batches.length > 1 ? `Reviewed all paragraphs in ${batches.length} parts; cross-section structure was not assessed.` : "", fragmentGroups.size ? "Oversized paragraphs used verified excerpts linked to their citations. This is a partial review; full-paragraph rewrites remain disabled." : "", limitedRelated ? "Some related-page comparisons were omitted to fit the review budget." : "", eligibleEdits.length > allowed.length || decisions.length > findings.length ? "Additional suggestions exceeded this run's save limit; run another review to address them." : ""].filter(Boolean).join(" ");
  const summary = [repairs.length ? `Consolidated ${repairs.length} duplicate section${repairs.length === 1 ? "" : "s"} into the introduction.` : "", answer.value.summary, scopeNote].filter(Boolean).join(" ") + vectorWarning + notes;
  progress?.(`Saving ${repairs.length + edits.length} fixes and ${findings.length} unresolved decisions…`);
  const saved = await measure("save", () => workflowWrite<PageReviewResult>(db, `review:${pageId}:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`, "complete_page_review", { p_page_id: pageId, p_snapshot: snapshot, p_review: { ...answer.value, summary: partial ? `Partial review. ${summary}` : summary, findings, coverageComplete: !partial }, p_edits: [...repairs, ...edits],
    p_trace: { modelVersion: answer.model, promptVersion: "page-review-v10", tokensIn: answer.tokensIn, tokensOut: answer.tokensOut, reviewBatches: batches.length, timingsMs: { ...timings }, concurrency: 3 } }));
  // In full auto the Reviewer's findings are acknowledged at once instead of waiting in Exceptions
  const accepted = await autoAcceptHeld(db, "reviewer", null, saved.exceptions);
  return { ...saved, exceptions: saved.exceptions - accepted.length };
}

export async function reviewRebuiltSections(db: DbRpc, settings: TokenFactorySettings, sectionIds: string[], embedder?: Embedder | null) {
  const pages = await db.call<string[]>("pages_needing_editorial_review", { p_section_ids: sectionIds });
  for (const pageId of pages) await runPageReview(db, settings, pageId, embedder);
}
