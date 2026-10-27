import Fuse from "fuse.js";
import { acronymOf, namesOf, roleNameVariant } from "@/lib/ai/tokenFactory/entityCleanup";
import type { ExistingEntity } from "@/lib/ai/types";
import type { AnswerClaim } from "@/lib/ai/tokenFactory/schema";

export type NameCandidate = { names: string[] };
export function fuzzyNameCandidates<T extends NameCandidate>(proposed: NameCandidate, existing: T[]): T[] {
  const index = new Fuse(existing, { keys: ["names"], threshold: 0.25, ignoreLocation: true, includeScore: true });
  const scores = new Map<number, number>();
  for (const name of proposed.names) for (const match of index.search(name)) {
    scores.set(match.refIndex, Math.min(scores.get(match.refIndex) ?? 1, match.score ?? 1));
  }
  return [...scores].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([i]) => existing[i]!);
}

export function identityNames(entity: ExistingEntity & { aliases?: string[] }): string[] {
  const names = namesOf({ ...entity, aliases: entity.aliases ?? [] });
  return [...new Set([...names, ...names.map(acronymOf).filter((name): name is string => !!name)])];
}

export type NameJudge = (proposed: unknown, candidates: unknown[]) => Promise<number | null>;
const entityKey = (entity: ExistingEntity) => `${entity.type}:${entity.key}`;

// Explicit numbered types are identities, not spelling variants. A fuzzy/AI
// match must never turn Type Five into Type Four; word and digit spellings of
// the same type still remain eligible for evidence-based alias review.
function differentNumberedTypes(left:string,right:string):boolean {
  const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
  const numbers=(name:string)=>[...new Set([...name.toLowerCase().matchAll(/\btype\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/g)].map(m=>words[m[1]!]??Number(m[1])))].sort((a,b)=>a-b);
  const a=numbers(left),b=numbers(right);
  return !!a.length&&!!b.length&&a.join(",")!==b.join(",");
}

// Resolve before action positions are assigned, so claims, scope and links stay consistent.
export async function reuseEntities(claims: AnswerClaim[], existing: ExistingEntity[], judge: NameJudge): Promise<AnswerClaim[]> {
  const known = [...existing];
  const resolved = new Map<string, ExistingEntity>();
  const refs = claims.flatMap((claim) => [...claim.entities, ...claim.applicability?.entities ?? []]);
  const evidence = (entity: ExistingEntity) => claims.filter((claim) => [...claim.entities, ...claim.applicability?.entities ?? []]
    .some((ref) => entityKey(ref) === entityKey(entity))).slice(0, 4).map((claim) => claim.content);
  for (const proposed of refs) {
    const key = entityKey(proposed);
    if (resolved.has(key)) continue;
    const exact = known.find((entity) => entityKey(entity) === key);
    if (exact) { resolved.set(key, exact); continue; }
    const fuzzy = fuzzyNameCandidates({ names: identityNames(proposed) }, known.map((entity) => ({ ...entity, names: identityNames(entity) })));
    const candidates = [...new Map([...fuzzy, ...known.filter((entity) => roleNameVariant(proposed, entity))].map((entity) => [entityKey(entity), entity])).values()]
      .filter(entity=>!differentNumberedTypes(proposed.name,entity.name));
    const choice = candidates.length ? await judge({ ...proposed, evidence: evidence(proposed) }, candidates.map((entity) => ({ ...entity, evidence: evidence(entity) }))) : null;
    if (choice !== null && !candidates[choice]) throw new Error("Entity duplicate review selected an unknown candidate.");
    const target = choice === null ? proposed : candidates[choice]!;
    resolved.set(key, target);
    if (choice === null) known.push(proposed);
  }
  const resolve = <T extends ExistingEntity>(ref: T): T => {
    const target = resolved.get(entityKey(ref));
    return target ? { ...ref, type: target.type, key: target.key, name: target.name } : ref;
  };
  // A structure label names its ends by type and key only: follow the same choices
  const resolveEnd = <T extends { type: string; key: string }>(ref: T): T => {
    const target = resolved.get(`${ref.type}:${ref.key}`);
    return target ? { ...ref, type: target.type, key: target.key } : ref;
  };
  return claims.map((claim) => ({ ...claim, entities: claim.entities.map(resolve),
    ...(claim.applicability ? { applicability: { ...claim.applicability, entities: claim.applicability.entities.map(resolve) } } : {}),
    ...(claim.stakeholderLinks ? { stakeholderLinks: claim.stakeholderLinks.map((label) => ({ ...label, from: resolveEnd(label.from), to: resolveEnd(label.to) })) } : {}) }));
}

// Compare sibling topics only. A confirmed parent rename carries its descendants with it.
export async function reuseFuzzyDomainPaths(paths: string[], existing: readonly string[], judge: NameJudge): Promise<Map<string, string>> {
  const known = new Set<string>();
  const remember = (path: string) => path.split("/").forEach((_, i, parts) => known.add(parts.slice(0, i + 1).join("/")));
  existing.forEach(remember);
  const resolved = new Map<string, string>();
  const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  for (const path of paths) {
    let parent = "", original = "";
    for (const name of path.split("/").map((part) => part.trim()).filter(Boolean)) {
      original = original ? `${original}/${name}` : name;
      const saved = resolved.get(original);
      if (saved) { parent = saved; continue; }
      const proposed = parent ? `${parent}/${name}` : name;
      let target = proposed;
      if (!known.has(proposed)) {
        const candidates = fuzzyNameCandidates({ names: identityNames({ type: "concept", key: name, name }) },
          [...known].filter((candidate) => parentOf(candidate) === parent&&!differentNumberedTypes(name,candidate.split("/").at(-1)!)).map((candidate) => ({
            path: candidate, names: identityNames({ type: "concept", key: candidate.split("/").at(-1)!, name: candidate.split("/").at(-1)! }),
          })));
        const choice = candidates.length ? await judge({ path: proposed }, candidates.map(({ path }) => ({ path }))) : null;
        if (choice !== null && !candidates[choice]) throw new Error("Domain duplicate review selected an unknown candidate.");
        if (choice !== null) target = candidates[choice]!.path;
      }
      resolved.set(original, target);
      remember(target);
      parent = target;
    }
    resolved.set(path, parent);
  }
  return resolved;
}
