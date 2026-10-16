import { z } from "zod";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { StageSkills } from "@/lib/ai/skills/types";
import type { ChatMessage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import { Constants, type Enums } from "@/lib/database/types";
import { unitRef } from "./prompt";

// =====================================================================
// LINK PASS: claims ingested before ingest proposed links have none, so
// this asks the model to link a batch of EXISTING units only. Same link
// rules as the reconciliation prompt (reconcile-v5), but the answer is
// just { links }, and every end is a unit ref (U1). linkAnswerToActions
// turns it into `link` DraftActions with targetId and toUnitId set.
// =====================================================================

// PROMPT VERSION: recorded on each ChangeSet this pass drafts
export const LINK_PROMPT_VERSION = "link-existing-v2";

// ONE UNIT THE MODEL MAY LINK (what it sees, plus the id it never sees)
// composite: a procedure or list; its steps come from its source, in its order, never from this pass
export type LinkPassUnit = { unitId: string; content: string; kind: Enums<"unit_kind">; domainPaths: string[]; composite?: boolean };

// AN EXISTING LINK BETWEEN TWO UNITS (to skip, and to show the model what is already there)
export type ExistingLink = { fromUnitId: string; toUnitId: string; type: Enums<"relationship_type"> };

// WHAT THE MODEL MUST ANSWER
const linkSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(Constants.public.Enums.relationship_type),
  reason: z.string(),
});

export const linkAnswerSchema = z.object({ links: z.array(linkSchema) });
export type LinkAnswer = z.infer<typeof linkAnswerSchema>;
export const linkAnswerJsonSchema = z.toJSONSchema(linkAnswerSchema);

const SYSTEM_PROMPT = `You maintain a universal knowledge store of atomic claims ("units"). You read a batch of EXISTING units and connect the ones that are related with typed links. You never change a unit.

Answer with JSON only: { "links": Link[] }. Each Link is { from, to, type, reason }.
- from and to: unit refs from the batch (e.g. "U3"). Never a ref that is not in the batch.
- type: supports (from is evidence for to), contradicts (they cannot both be true), depends_on (from only holds if to holds), part_of (from is a piece of the larger to), derived_from (from was worked out from to), supersedes (from replaces to), related_to (same specific topic, none of the above).
- Link only units that are clearly about the same specific thing: the same policy, procedure, program, equipment, definition or decision. Sharing a company, a broad topic or a domain is not enough.
- Prefer the most specific type; use related_to only when no other type fits.
- A definition and a claim that uses the defined term: link the claim to the definition with depends_on.
- At most 3 links per unit; never link a unit to itself; never repeat a link listed in existingLinks.
- Never link part_of into a unit marked composite: its steps or items come from its source, in order.
- reason: a few words on why they are linked.
- If nothing in the batch is clearly related, return an empty links list.`;

// The user message: the batch with short refs instead of ids, and the links it already has
export function buildLinkMessages(units: LinkPassUnit[], existing: ExistingLink[], skills?: StageSkills): ChatMessage[] {
  const refById = new Map(units.map((unit, index) => [unit.unitId, unitRef(index)]));
  const payload = {
    units: units.map((unit, index) => ({ ref: unitRef(index), content: unit.content, kind: unit.kind, domains: unit.domainPaths, ...(unit.composite ? { composite: true } : {}) })),
    existingLinks: existing.flatMap((link) => {
      const from = refById.get(link.fromUnitId), to = refById.get(link.toUnitId);
      return from && to ? [{ from, to, type: link.type }] : [];
    }),
  };
  return [
    { role: "system", content: `${SYSTEM_PROMPT}

${skillInstructions(["link_knowledge"],skills)}` },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

// ANSWER -> LINK ACTIONS: unknown refs, self links, repeats and links the store
// already has are dropped (related_to and contradicts count both ways)
export function linkAnswerToActions(answer: LinkAnswer, units: LinkPassUnit[], existing: ExistingLink[]): DraftAction[] {
  const idByRef = new Map(units.map((unit, index) => [unitRef(index), unit.unitId]));
  const seen = new Set(existing.map((link) => linkKey(link)));
  const composites = new Set(units.filter((unit) => unit.composite).map((unit) => unit.unitId));
  return answer.links.flatMap((link): DraftAction[] => {
    const fromUnitId = idByRef.get(link.from.trim().toUpperCase());
    const toUnitId = idByRef.get(link.to.trim().toUpperCase());
    if (!fromUnitId || !toUnitId || fromUnitId === toUnitId) return [];
    if (link.type === "part_of" && composites.has(toUnitId)) return [];
    const key = linkKey({ fromUnitId, toUnitId, type: link.type });
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      type: "link",
      targetId: fromUnitId,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { toUnitId, type: link.type },
    }];
  });
}

// ONE KEY PER LINK: symmetric types sort their ends so the reverse pair is the same link
function linkKey({ fromUnitId, toUnitId, type }: ExistingLink): string {
  const symmetric = type === "related_to" || type === "contradicts";
  const [a, b] = symmetric && toUnitId < fromUnitId ? [toUnitId, fromUnitId] : [fromUnitId, toUnitId];
  return `${type}:${a}|${b}`;
}

// BATCHES: units ordered by their first domain path (then content), cut into
// fixed-size runs, so claims on the same and neighbouring topics are read together
export function linkBatches(units: LinkPassUnit[], size: number): LinkPassUnit[][] {
  const topic = (unit: LinkPassUnit) => [...unit.domainPaths].sort()[0] ?? "￿";
  const ordered = [...units].sort((a, b) => topic(a).localeCompare(topic(b)) || a.content.localeCompare(b.content));
  const batches: LinkPassUnit[][] = [];
  for (let start = 0; start < ordered.length; start += size) batches.push(ordered.slice(start, start + size));
  return batches;
}
