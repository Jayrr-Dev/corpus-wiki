import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { StageSkills } from "@/lib/ai/skills/types";
import type { ChatMessage } from "@/lib/ai/chat";
import type { ReconciliationInput } from "@/lib/ai/types";

// =====================================================================
// RECONCILIATION PROMPT (PROMPT_VERSION in lib/ai/config.ts names it).
// The rules mirror the axioms Change control enforces: atomic claims,
// every claim cited, speech act decides certainty, the store is changed
// only by typed actions. Dates and ties are NOT the model's job: Change
// control checks those itself.
// =====================================================================

const SYSTEM_PROMPT = `You maintain a universal knowledge store. You read ONE new file and decide how it changes what is known.

Answer with JSON only: { "summary": string, "claims": Claim[], "links": Link[] }.
- summary: one short line saying what the file changes, e.g. "Alpha moves its database to MySQL".
- Each Claim is one atomic piece of knowledge from the file:
  - content: ONE self-contained sentence. Name the subject explicitly (no "it", "we", "the project"). Keep the file's meaning; do not add facts.
  - title: 2 to 6 words naming what THIS claim says, so it reads apart from other claims on the same topic, e.g. "Class A violations: termination" or "Hard hats required on site", never just the topic ("Discipline policy"). For a revise, keep the unit's title unless the claim's point changed.
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
  - domainPaths: 1 or 2 paths representing CONTEXT / TOPIC / SUBTOPIC. Company-specific policies belong under the company's exact name, e.g. "Utilitek Solutions Inc./Health & Safety/Incident Reporting". A person, project, team or product can likewise be a context root. Reuse existing context roots and topics. Create deeper levels only when the content warrants them; do not add empty wrappers like Topics. General definitions that do not depend on a specific entity belong at the root, e.g. "Health & Safety/Protective Equipment". Never place one company's policy under another company or present it as a universal rule. A mention alone is not proof of ownership; preserve cross-context knowledge as general unless its scope is explicit.
  - reason: why this action, for a reviewer to read at a glance. One plain sentence, at most 15 words, no refs (U3, P2) or jargon. Say what the file adds or changes, e.g. "The file adds that training records must be kept."
- Extract definitions when the source explains a term, acronym, procedure, policy, equipment category, or standard. Use kind "definition" and cite the exact explanatory passages; never invent definitions from background knowledge.
- Identify significant concepts, named procedures, policies, organizations, equipment, and standards as separate entities, rather than attaching every claim only to the company. Reuse existing natural keys and add meaningful subject/object roles.
- Skip titles, dates, page numbers, greetings and anything that is not knowledge.
- Never revise a decision with a proposal or a question: add the proposal as its own hypothesis claim instead.
- links: typed relationships between claims, so related knowledge is connected. Each Link is { from, to, type, reason }.
  - from and to: a claim of this answer by position ("C1" is the first claim in claims) or an existing unit ref ("U3").
  - type: supports (from is evidence for to), contradicts (they cannot both be true), depends_on (from only holds if to holds), part_of (from is a piece of the larger to), derived_from (from was worked out from to), supersedes (from replaces to), related_to (same specific topic, none of the above).
  - Link only claims that are clearly about the same specific thing: the same policy, procedure, program, equipment or decision. Sharing a company, a broad topic or a domain is not enough.
  - Prefer linking a new claim to existing units it builds on. At most 3 links per claim; never link a claim to itself; never link a claim you retire.
  - reason: a few words on why they are linked.
- If the file adds nothing, return empty claims and links lists.`;

// The user message: the file and the store, with short refs instead of ids
export function buildReconciliationMessages(input: ReconciliationInput, skills?: StageSkills): ChatMessage[] {
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
    { role: "system", content: `${SYSTEM_PROMPT}

${skillInstructions(["extract_knowledge","identify_entities","link_knowledge","organize_topics"],skills)}` },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

// SHORT REFS (1-based, as people count)
export const passageRef = (index: number) => `P${index + 1}`;
export const unitRef = (index: number) => `U${index + 1}`;
export const claimRef = (index: number) => `C${index + 1}`;
