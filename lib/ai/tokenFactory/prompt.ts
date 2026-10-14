import type { ChatMessage } from "@/lib/ai/chat";
import type { ReconciliationInput } from "@/lib/ai/types";

// =====================================================================
// RECONCILIATION PROMPT (PROMPT_VERSION in lib/ai/config.ts names it).
// The rules mirror the axioms Change control enforces: atomic claims,
// every claim cited, speech act decides certainty, the store is changed
// only by typed actions. Dates and ties are NOT the model's job: Change
// control checks those itself.
// =====================================================================

const SYSTEM_PROMPT = `You maintain a company's knowledge store. You read ONE new file and decide how it changes what is known.

Answer with JSON only: { "summary": string, "claims": Claim[] }.
- summary: one short line saying what the file changes, e.g. "Alpha moves its database to MySQL".
- Each Claim is one atomic piece of knowledge from the file:
  - content: ONE self-contained sentence. Name the subject explicitly (no "it", "we", "the project"). Keep the file's meaning; do not add facts.
  - action:
    - "add": nothing in the existing units says this yet. unit = null.
    - "revise": an existing unit is about the same thing (same subject and question) and this file restates or changes it. unit = its ref (e.g. "U3"). If the file says exactly the same thing, repeat the unit's content word for word.
    - "retire": the file says an existing unit is no longer true and nothing replaces it. unit = its ref.
    - "set_status": only the certainty of an existing unit changes. unit = its ref.
  - kind: decision (something was decided), fact, definition, procedure, or preference.
  - speechAct: decided (a decision was made), stated (stated as true), proposed (a suggestion), asked (a question).
  - epistemicStatus: established (decided, or stated by an authoritative source), supported (stated with evidence), assumed, hypothesis (anything proposed or asked: never a decision), disputed, unknown.
  - passages: the refs (e.g. "P2") of the passages the claim comes from. At least one.
  - entities: the real things the claim is about, as { type, key, name, role }. type is lowercase (project, person, team, product, company, tool, ...). key is the lowercase name with spaces as hyphens. Reuse an existing entity's type and key when it is the same thing. role: subject (what the claim is about), object, or mentioned.
  - domainPaths: 1 or 2 domain paths the claim belongs to. Prefer existing paths. If none fits, write a new path under an existing parent, at most 3 levels deep, e.g. "Topics/Finance".
  - reason: a few words on why this action.
- Skip titles, dates, page numbers, greetings and anything that is not knowledge.
- Never revise a decision with a proposal or a question: add the proposal as its own hypothesis claim instead.
- If the file adds nothing, return an empty claims list.`;

// The user message: the file and the store, with short refs instead of ids
export function buildReconciliationMessages(input: ReconciliationInput): ChatMessage[] {
  const payload = {
    file: { title: input.source.title, date: input.source.sourceDate.slice(0, 10) },
    passages: input.passages.map((p, i) => ({ ref: passageRef(i), text: p.text, speaker: p.speakerLabel ?? undefined })),
    existingUnits: input.existingUnits.map((u, i) => ({
      ref: unitRef(i),
      content: u.content,
      kind: u.kind,
      epistemicStatus: u.epistemicStatus,
    })),
    existingDomainPaths: input.domainPaths,
    existingEntities: input.entities,
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

// SHORT REFS (1-based, as people count)
export const passageRef = (index: number) => `P${index + 1}`;
export const unitRef = (index: number) => `U${index + 1}`;
