import { createHash } from "node:crypto";

// =====================================================================
// FILING CHECKPOINT KEYS: upload filing saves each plan step and each
// reviewed batch in upload_steps. Keys used to start with a fingerprint of
// the whole upload context (place-v4), so any change to it (another upload
// filing a neighbor, a new domain) discarded every checkpoint, and two plan
// runs of one PDF were lost that way. A step is now keyed by what it decides:
// its claims (stable ref, unit and revision) and, for a batch, its scope.
// The upload is the step's event; the version names the output contract.
// =====================================================================

export const FILING_STEP_VERSION = "place-v5";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

export function filingStepKey(step: string, claims: { ref?: string; unitId: string; content: string }[], revisions: ReadonlyMap<string, string>, scope?: string): string {
  return `${FILING_STEP_VERSION}:${step}:${hash([scope ?? null, claims.map((claim) => [claim.ref ?? null, claim.unitId, revisions.get(claim.unitId) ?? claim.content])])}`;
}

// UPLOADS ALREADY IN FLIGHT: their place-v4 checkpoints still count while the context they
// were keyed by is unchanged, as before; they are copied to the durable key on first use.
export const legacyFilingPrefix = (context: unknown) => `place-v4:${hash(context)}`;

// The place-v4 review key: a hash of the request input, object keys sorted
// (jsonb checkpoints reorder them), arrays in order
export const legacyReviewKey = (input: unknown) => createHash("sha256").update(JSON.stringify(input, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex").slice(0, 24);
