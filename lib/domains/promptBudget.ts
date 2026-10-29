import type { ChatMessage } from "@/lib/ai/chat";

// Haiku charges its long-context rate past 100k prompt tokens. Replayed uploads
// sent to Haiku 5.5 billed about 2.45 characters per token for these JSON
// prompts (schema included); 2.4 keeps the estimate on the safe side.
export const PROMPT_TOKEN_LIMIT = 100_000;
const CHARS_PER_TOKEN = 2.4;

// On by default (docs/progress-2026-10-29.md): each batch gets only its own
// neighbors, and batches that would still cross the limit are split.
// TOPIC_PROMPT_BUDGET=off keeps the original prompts while production is
// watched for placement regressions (#43); remove it once that week passes.
export const topicPromptBudgetOn = (env: Record<string, string | undefined> = process.env) => env.TOPIC_PROMPT_BUDGET !== "off";

export function estimatePromptTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).length, 0) / CHARS_PER_TOKEN);
}

export const BUDGET_PROFILE_NOTE = "profiles[].exampleRefs name entries in neighbors; read their full text there.";

type Neighbor = { ref: string; content: string; domains: string[] };
type Profile = { path: string; totalClaims: number; examples: { ref: string; content: string }[] };
type Candidate = { ref: string; neighbors: { ref: string }[] };
type Link = { from: string; to: string };

// Neighbors and profiles cover the whole upload, so every batch used to carry
// every other claim's neighbors too. Keep the saved claims this batch's own
// candidates or links name; profile examples point at them instead of repeating text.
export function scopeNeighbors(batchRefs: ReadonlySet<string>, evidence: { neighbors: Neighbor[]; domainProfiles: Profile[]; candidates: Candidate[]; links: Link[] }) {
  const keep = new Set<string>();
  for (const c of evidence.candidates) if (batchRefs.has(c.ref)) c.neighbors.forEach(n => keep.add(n.ref));
  for (const l of evidence.links) {
    if (batchRefs.has(l.from)) keep.add(l.to);
    if (batchRefs.has(l.to)) keep.add(l.from);
  }
  const neighbors = evidence.neighbors.filter(n => keep.has(n.ref));
  const profiles = evidence.domainProfiles.flatMap(p => {
    const exampleRefs = p.examples.map(e => e.ref).filter(ref => keep.has(ref));
    return exampleRefs.length ? [{ path: p.path, totalClaims: p.totalClaims, exampleRefs }] : [];
  });
  return { neighbors, profiles };
}
