// =====================================================================
// CLAIM EMBEDDING TEXT (#39): what a claim's vector is made from. The
// claim's subject entities and, when it is scoped, where it applies go in
// front of its wording, so the same sentence about two entities gets two
// vectors. Stored claims (lib/knowledge/embeddingStore.ts) and drafts that
// are compared with them (the duplicate guard, the split reconciler) use
// this one function, so both sides of a comparison read the same way.
// The topic path is left out: topic filing reads these vectors to choose it.
// =====================================================================

// The text version saved with each vector (public.unit_embeddings.text_version).
// Bump it when the text below changes; every claim is then re-embedded once
// (scripts/reembed-claims.ts). 1 was the bare claim.
export const CLAIM_TEXT_VERSION = 2;

// THE PREFIX'S PARTS: entity names, not keys
export type ClaimTextContext = { subjects: readonly string[]; scope: readonly string[]; conditions: string | null };

const NO_CONTEXT: ClaimTextContext = { subjects: [], scope: [], conditions: null };

// Names trimmed, blanks and repeats dropped, sorted so the order never changes the vector
const names = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// "Acme Inc. · Applies to: Plant 2 · Training is required annually"; a claim without context stays bare.
// Version 1 is always the bare claim, so rolling back is setting CLAIM_TEXT_VERSION to 1.
export function claimEmbeddingText(content: string, context: ClaimTextContext = NO_CONTEXT, version: number = CLAIM_TEXT_VERSION): string {
  if (version < 2) return content;
  const scope = [...names(context.scope), ...(context.conditions?.trim() ? [context.conditions.trim()] : [])];
  return [names(context.subjects).join(", "), scope.length ? `Applies to: ${scope.join(", ")}` : "", content]
    .filter(Boolean).join(" · ");
}

// A drafted claim's parts: its subject entities, and scope only when it is scoped
type DraftEntity = { name?: string; key: string; role?: string };
type DraftScope = { status: string; entities: readonly DraftEntity[]; conditions: string | null };
export function draftTextContext(entities: readonly DraftEntity[], applicability?: DraftScope | null): ClaimTextContext {
  const scope = applicability?.status === "scoped" ? applicability : null;
  return {
    subjects: entities.filter((entity) => entity.role === "subject").map((entity) => entity.name || entity.key),
    scope: scope?.entities.map((entity) => entity.name || entity.key) ?? [],
    conditions: scope?.conditions ?? null,
  };
}
