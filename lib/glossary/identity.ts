import { createHash, randomUUID } from "node:crypto";
import Fuse from "fuse.js";
import { GLOSSARY_MERGE_VERSION, glossaryHistoryKeys, glossaryOriginKey, type GlossaryCitation, type GlossaryEntry, type GlossaryOverride } from "./entries";

export function identifyGlossaryEntries(entries: GlossaryEntry[], registry: Record<string, string>, overrides: Record<string, GlossaryOverride> = {}, previous: GlossaryEntry[] = []): GlossaryEntry[] {
  return entries.flatMap((entry) => {
    const origin = glossaryOriginKey(entry);
    const sense = `${origin}#sense:${createHash("sha256").update(entry.definition).digest("hex")}`;
    const originKeys = [...new Set([sense, ...entry.originKeys ?? []])];
    const units = new Set(entry.citations.map((cite) => cite.unitId));
    const matches = new Fuse(previous.filter((other) => other.citations.some((cite) => units.has(cite.unitId))
      && (!other.expansion || !entry.expansion || other.expansion.toLowerCase() === entry.expansion.toLowerCase())), {
      keys: ["term", "aliases", "expansion"], threshold: 0.15, ignoreLocation: true,
    }).search(entry.expansion || entry.term).map((match) => match.item);
    const exact = matches.filter((other) => other.term.toLowerCase() === entry.term.toLowerCase() && other.scopeKey === entry.scopeKey);
    const prior = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    const meaningId = originKeys.map((key) => registry[key]).find(Boolean) ?? registry[origin] ?? entry.meaningId ?? prior?.meaningId ?? randomUUID();
    const override = overrides[meaningId];
    if (override?.deleted) return [];
    return [{ ...entry, meaningId, originKeys, historyKeys: [...new Set([...glossaryHistoryKeys(entry), ...prior ? glossaryHistoryKeys(prior) : []])],
      ...(prior?.meaningId === meaningId ? { redirectIds: prior.redirectIds } : {}),
      ...(override?.definition ? { sourceDefinition: entry.definition, definition: override.definition, personEdited: true } : {}),
      ...(override?.separate ? { keepSeparate: true } : {}) }];
  });
}

export function glossaryRegistry(entries: GlossaryEntry[], previous: Record<string, string>): Record<string, string> {
  const registry = { ...previous };
  for (const entry of entries) {
    if (!entry.meaningId) throw new Error("A glossary meaning has no stable identity.");
    for (const key of entry.originKeys ?? [glossaryOriginKey(entry)]) registry[key] = entry.meaningId;
    for (const [key, id] of Object.entries(registry)) if (entry.redirectIds?.includes(id)) registry[key] = entry.meaningId;
  }
  return registry;
}

// Reuse reviewed meanings only when every contributing origin and cited revision
// still exists. New/changed evidence alone goes through the detector on later uploads.
export function reuseReviewedMeanings(entries: GlossaryEntry[], previous: GlossaryEntry[], registry: Record<string, string>, current: (cite: GlossaryCitation) => boolean): GlossaryEntry[] {
  const byOrigin = new Map(entries.flatMap((entry) => (entry.originKeys ?? []).map((key) => [key, entry] as const)));
  const reused: GlossaryEntry[] = [];
  const consumed = new Set<GlossaryEntry>();
  for (const meaning of previous) {
    // The initial adoption predates this marker; later policy changes must recheck it.
    if ((meaning.reviewVersion ?? "canonical-meanings-usage-v3") !== GLOSSARY_MERGE_VERSION) continue;
    if (!meaning.meaningId || meaning.usageNotes === undefined || !meaning.originKeys?.length || !meaning.citations.every(current)) continue;
    const members = meaning.originKeys.map((key) => byOrigin.get(key));
    if (!members.every((entry, i) => entry?.meaningId === meaning.meaningId && registry[meaning.originKeys![i]!] === meaning.meaningId)) continue;
    reused.push({ ...meaning, established: true });
    members.forEach((entry) => consumed.add(entry!));
  }
  return [...reused, ...entries.filter((entry) => !consumed.has(entry))];
}
