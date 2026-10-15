import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// DUPLICATE JUDGE (ingest): before an upload's new claims are saved, the
// model reads each one next to the stored claims (U refs) and earlier new
// claims of the same file (N refs) that look alike, and says whether it is
// the same claim, the same claim with an extra detail, or a different one.
// lib/ingest/duplicateGuard.ts picks the look-alikes and acts on the answer.
// =====================================================================

// WHAT THE MODEL READS: new claims, each with the refs it may duplicate
export type JudgeClaim = { ref: string; content: string; candidates: string[] };
export type JudgeRequest = { claims: JudgeClaim[]; known: { ref: string; content: string }[] };

const decisionSchema = z.object({
  claim: z.string(),
  verdict: z.enum(["same", "adds_detail", "different"]),
  match: z.string().nullable(),
  content: z.string().nullable(),
  reason: z.string(),
});

export const judgeAnswerSchema = z.object({ decisions: z.array(decisionSchema) });
export type JudgeAnswer = z.infer<typeof judgeAnswerSchema>;
export type JudgeDecision = z.infer<typeof decisionSchema>;
export const judgeAnswerJsonSchema = z.toJSONSchema(judgeAnswerSchema);

const SYSTEM_PROMPT = `You keep a knowledge store of atomic claims free of duplicates. New claims were just read from a file. Each new claim lists candidates: stored claims (U refs) or earlier new claims from the same file (N refs) that look alike. Decide, for each new claim, whether it repeats one of its candidates.

Answer with JSON only: { "decisions": Decision[] }, one Decision per new claim: { claim, verdict, match, content, reason }.
- verdict "same": the candidate already says everything the new claim says (same subject, same facts; wording, order and detail level may differ, and the candidate may say more). match = that candidate's ref. content = null.
- verdict "adds_detail": the same claim, but the new one adds a detail the candidate lacks, and nothing contradicts it. match = that candidate's ref. content = ONE self-contained sentence (two at most) that keeps everything the candidate says and adds the new detail. Never add anything neither says.
- verdict "different": not the same claim. match = null, content = null. Use this when any fact differs (a number, date, frequency, scope, party, condition) or when one is only related to the other (same topic, different point).
- Only choose a match from that claim's own candidates. When several fit, pick the closest.
- reason: a few plain words on why, for a person to read; never mention refs like U1 or N2.`;

// The user message: the new claims with their candidates, and the text of every ref they name
export function buildJudgeMessages(request: JudgeRequest): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ newClaims: request.claims, candidates: request.known }) },
  ];
}

// Each new claim's decision, keyed by its ref; a decision naming a ref outside its
// candidates, or a merge without wording, falls back to "different" (keep the claim)
export function readJudgeAnswer(answer: JudgeAnswer, request: JudgeRequest): Map<string, JudgeDecision> {
  const byRef = new Map(request.claims.map((claim) => [claim.ref, claim]));
  const decisions = new Map<string, JudgeDecision>();
  for (const decision of answer.decisions) {
    const ref = decision.claim.trim().toUpperCase();
    const claim = byRef.get(ref);
    if (!claim || decisions.has(ref)) continue;
    const match = decision.match?.trim().toUpperCase() ?? null;
    const usable = decision.verdict !== "different" && match !== null && claim.candidates.includes(match)
      && (decision.verdict === "same" || Boolean(decision.content?.trim()));
    decisions.set(ref, usable ? { ...decision, claim: ref, match } : { ...decision, claim: ref, verdict: "different", match: null, content: null });
  }
  return decisions;
}
