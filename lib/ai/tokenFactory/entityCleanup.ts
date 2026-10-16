import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// ENTITY CLEANUP: after an upload, entities nothing uses are retired and
// duplicates are merged, without a person (both undoable from Changes).
// Finding duplicates is cheap and deterministic here: two live entities
// whose names, aliases, keys or acronyms match are candidates, whatever
// their type ("EPCOR" the company and "EPCOR" the organization, "FAA"
// and "Federal Aviation Administration"). A name match is not proof (two
// people can share a name), so the model judges each group and only
// groups it is sure of are merged.
// =====================================================================

export const ENTITY_CLEANUP_PROMPT_VERSION = "entity-cleanup-v2";

// WHAT THE CLEANUP READS PER LIVE ENTITY (public.entity_cleanup_input)
export type CleanupEntity = {
  id: string; type: string; key: string; name: string; aliases: string[]; description: string | null;
  claims: number; anchored: boolean; inUse: boolean;
};

// Words a name can carry or drop without naming a different thing
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "ltd", "limited", "llc", "llp", "corp", "corporation", "co", "plc", "gmbh", "ag", "sa", "pty"]);
const ACRONYM_SKIPS = new Set(["of", "the", "and", "for", "a", "an", "to", "in", "on", "de", "du", "la", "le"]);

// "Utilitek Solutions Inc." -> "utilitek solutions"; "The City of Edmonton" -> "city of edmonton"
export function normalizeName(text: string): string {
  const words = text
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join(" ");
}

// The last word made singular: "land agents" -> "land agent", "companies" -> "company"; "class" stays
export function singularOf(name: string): string {
  return name.replace(/(\w{3,}?)ies$/, "$1y").replace(/(\w{3,}[^s])s$/, "$1");
}

// "Federal Aviation Administration" -> "faa"; one-word names have no acronym
export function acronymOf(text: string): string | null {
  const words = normalizeName(text).split(" ").filter((word) => word && !ACRONYM_SKIPS.has(word));
  return words.length >= 2 ? words.map((word) => word[0]).join("") : null;
}

// Every name an entity goes by: its name with and without a bracketed part, the bracket
// itself ("American Society for Quality (ASQ)" -> both), its aliases and its key
export function namesOf(entity: Pick<CleanupEntity, "name" | "aliases" | "key">): string[] {
  const names = new Set<string>();
  for (const raw of [entity.name, ...entity.aliases, entity.key.replace(/-/g, " ")]) {
    const add = (text: string) => {
      const normal = normalizeName(text);
      if (normal.length < 2) return;
      names.add(normal);
      // "Stakeholders" and "Stakeholder" name the same thing: the singular is a name too
      const singular = singularOf(normal);
      if (singular !== normal) names.add(singular);
    };
    add(raw);
    const bracket = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(raw);
    if (bracket) { add(bracket[1]!); add(bracket[2]!); }
  }
  return [...names];
}

// CANDIDATE GROUPS: entities linked by any shared name or an acronym of one matching another's
// name, joined transitively. Only groups touching `focus` are returned (all when null), so an
// upload re-judges only what it could have changed.
export function duplicateCandidates(entities: CleanupEntity[], focus: ReadonlySet<string> | null): CleanupEntity[][] {
  const parent = new Map(entities.map((entity) => [entity.id, entity.id]));
  const find = (id: string): string => { const up = parent.get(id)!; if (up === id) return id; const root = find(up); parent.set(id, root); return root; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const byName = new Map<string, string>();
  const acronyms: [string, string][] = [];
  for (const entity of entities) {
    for (const name of namesOf(entity)) {
      const other = byName.get(name);
      if (other) union(other, entity.id); else byName.set(name, entity.id);
      const acronym = acronymOf(name);
      if (acronym && acronym.length >= 2) acronyms.push([acronym, entity.id]);
    }
  }
  for (const [acronym, id] of acronyms) {
    const other = byName.get(acronym);
    if (other && other !== id) union(other, id);
  }
  const groups = new Map<string, CleanupEntity[]>();
  for (const entity of entities) groups.set(find(entity.id), [...(groups.get(find(entity.id)) ?? []), entity]);
  return [...groups.values()].filter((group) => group.length > 1 && (!focus || group.some((entity) => focus.has(entity.id))));
}

// THE ENTITY THAT STAYS: one that anchors pages or topics (it cannot be merged away), then the
// one with more claims, then the longer (fuller) name. Null when two anchor content: a person decides.
export function survivorOf(group: CleanupEntity[]): CleanupEntity | null {
  if (group.filter((entity) => entity.anchored).length > 1) return null;
  return [...group].sort((a, b) => Number(b.anchored) - Number(a.anchored) || b.claims - a.claims || b.name.length - a.name.length || a.id.localeCompare(b.id))[0] ?? null;
}

// ---------------------------------------------------------------------
// THE JUDGE
// ---------------------------------------------------------------------

const answerSchema = z.object({
  groups: z.array(z.object({ ref: z.string(), same: z.array(z.array(z.string())), reason: z.string() })),
});
export const cleanupAnswerSchema = answerSchema;
export type CleanupAnswer = z.infer<typeof answerSchema>;
export const cleanupAnswerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You find duplicate entities in a knowledge store. Each group lists entities whose names look alike. Decide which of them are the SAME real-world thing (the same organization, person, place, role, document...), recorded twice under different types or spellings.

Answer with JSON only: { "groups": [{ "ref": "G1", "same": [["G1.1", "G1.3"]], "reason": "..." }] }, one item per group.
- "same" lists sets of entity refs you are SURE are one thing. Leave an entity out when unsure. An empty list means none are the same.
- Same name is not enough: two people can share a name; a company and its product, a law and the agency that enforces it, a parent company and its subsidiary, or a thing and a course, training, policy or document about it (fire extinguishers and a fire extinguisher course) are different things.
- An acronym and its full name are the same thing only when the descriptions agree.
- reason: one short sentence.`;

// Refs: G1 for a group, G1.2 for its second entity
export function buildCleanupMessages(groups: CleanupEntity[][]): ChatMessage[] {
  const payload = {
    groups: groups.map((group, g) => ({
      ref: `G${g + 1}`,
      entities: group.map((entity, e) => ({
        ref: `G${g + 1}.${e + 1}`, type: entity.type, name: entity.name, aliases: entity.aliases,
        description: entity.description ?? "", claims: entity.claims,
      })),
    })),
  };
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }];
}

// ANSWER -> the merges to make: each confirmed set folds into its survivor. Unknown refs, refs
// from another group and sets of one are ignored; an entity is merged at most once.
export function readMerges(answer: CleanupAnswer, groups: CleanupEntity[][]): { from: CleanupEntity; into: CleanupEntity; reason: string }[] {
  const merges: { from: CleanupEntity; into: CleanupEntity; reason: string }[] = [];
  const used = new Set<string>();
  for (const item of answer.groups) {
    const g = Number(/^G(\d+)$/i.exec(item.ref.trim())?.[1]) - 1;
    const group = groups[g];
    if (!group) continue;
    for (const set of item.same) {
      const members = [...new Set(set.flatMap((ref) => {
        const match = /^G(\d+)\.(\d+)$/i.exec(ref.trim());
        const entity = match && Number(match[1]) - 1 === g ? group[Number(match[2]) - 1] : undefined;
        return entity && !used.has(entity.id) ? [entity] : [];
      }))];
      if (members.length < 2) continue;
      const into = survivorOf(members);
      if (!into) continue;
      for (const from of members) {
        if (from.id === into.id || from.anchored) continue;
        merges.push({ from, into, reason: item.reason.trim() || "The same thing recorded twice" });
        used.add(from.id);
      }
      used.add(into.id);
    }
  }
  return merges;
}
