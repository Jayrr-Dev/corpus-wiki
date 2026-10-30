import { cosine, overlap, wordSet } from "@/lib/knowledge/similarity";
import type { DecisionSnapshot, DomainConnection } from "./decider";
import type { PlaceTopicsInput, TopicClaim } from "@/lib/ai/tokenFactory/placeTopics";

export type UploadTopicContext = {
  claims: TopicClaim[]; domainPaths: string[]; domainTabs: PlaceTopicsInput["domainTabs"];
  sourceTitle: string; sourceSections: { position: number; location: unknown }[];
  revisions: { unitId: string; revisionId: string }[];
  evidence: { unitId: string; passages: { location: unknown; text: string }[] }[];
  snapshot: DecisionSnapshot; connections: DomainConnection[];
  vectors: { revisionId: string; model: string; embedding: string }[];
};

// Similarity and links nominate destinations; the AI decides whether their meaning fits.
export function uploadAssignmentEvidence(context: UploadTopicContext) {
  const claims = context.claims.map((c, i) => ({ ...c, ref: `C${i + 1}` }));
  const refs = new Map(claims.map(c => [c.unitId, c.ref]));
  const revisions = new Map(context.revisions.map(r => [r.unitId, r.revisionId]));
  const vectors = new Map(context.vectors.map(v => [v.revisionId, { model: v.model, value: JSON.parse(v.embedding) as number[] }]));
  const paths = new Map(context.snapshot.domains.filter(d => !d.retired_at).map(d => [d.id, d.path]));
  const memberships = new Map<string, string[]>();
  for (const m of context.snapshot.unitDomains) {
    const path = paths.get(m.domain_id);
    if (path) memberships.set(m.unit_id, [...(memberships.get(m.unit_id) ?? []), path]);
  }
  const saved = context.snapshot.claims.filter(c => !c.retiredAt && !refs.has(c.id) && memberships.has(c.id));
  const neighborIds = new Set<string>();
  const candidates = claims.map(claim => {
    const a = vectors.get(revisions.get(claim.unitId) ?? "");
    const linked = new Set(context.connections.flatMap(e => e.from === claim.unitId ? [e.to] : e.to === claim.unitId ? [e.from] : []));
    const nearest = saved.map(other => {
      const b = vectors.get(other.revisionId);
      const semantic = a && b && a.model === b.model ? cosine(a.value, b.value) : overlap(wordSet(claim.content), wordSet(other.content));
      return { id: other.id, score: semantic, connected: linked.has(other.id) };
    }).filter(c => c.connected || c.score >= 0.55).sort((a,b) => Number(b.connected)-Number(a.connected) || b.score-a.score).slice(0,8);
    nearest.forEach(n => neighborIds.add(n.id));
    return { ref: claim.ref, neighbors: nearest };
  });
  const neighbors = saved.filter(c => neighborIds.has(c.id)).map((c,i) => ({ ref: `E${i+1}`, unitId: c.id, content: c.content, domains: memberships.get(c.id)! }));
  const neighborRefs = new Map(neighbors.map(c => [c.unitId,c.ref]));
  const allRefs = new Map([...refs,...neighborRefs]);
  const links = context.connections.flatMap(e => {
    const from = allRefs.get(e.from), to = allRefs.get(e.to);
    return from && to ? [{ from,to,type:e.type }] : [];
  });
  const domainProfiles = [...new Set(neighbors.flatMap(c => c.domains))].map(path => ({ path,
    totalClaims: context.snapshot.unitDomains.filter(m => paths.get(m.domain_id) === path).length,
    examples: neighbors.filter(c => c.domains.includes(path)).map(c => ({ ref:c.ref,content:c.content })),
  }));
  return { claims, candidates: candidates.map(c => ({ ref:c.ref,neighbors:c.neighbors.map(n => ({ ref:neighborRefs.get(n.id)!,similarity:Math.round(n.score*1000)/1000,connected:n.connected })) })),
    neighbors: neighbors.map(c => ({ref:c.ref,content:c.content,domains:c.domains})), links,domainProfiles,
    evidence: claims.map(c => ({ref:c.ref,passages:context.evidence.find(e => e.unitId===c.unitId)?.passages ?? []})),
  };
}

export function validateUploadGroups(groups: {scopePath:string; refs:string[]}[], claims: TopicClaim[], knownPaths: string[]) {
  const expected = new Set(claims.map(c => c.ref!));
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group.refs.length || !group.scopePath.trim() || group.scopePath.split("/").some(p => !p.trim())) throw new Error("Each assignment group needs a valid scope and claims.");
    if (!knownPaths.includes(group.scopePath) && group.scopePath.includes("/")) throw new Error(`Choose an existing domain scope, or propose a new root for approval. Invalid scopePath: ${JSON.stringify(group.scopePath)}. This path does not exist. A new scopePath must be ONE root name with no slash; put its narrower subject in the subject field. Child paths are proposed during placement, after planning. Existing scopes: ${JSON.stringify(knownPaths)}.`);
    for (const ref of group.refs) {
      if (!expected.has(ref) || seen.has(ref)) throw new Error(`Unknown or repeated claim ${ref} in domain plan.`);
      seen.add(ref);
    }
  }
  if (seen.size !== expected.size) throw new Error("The domain plan omitted knowledge units. Account for every claim.");
}

// The deepest part of a path that exists, or its root as a new proposal. Children come at placement.
const nearestScope = (path: string, knownPaths: string[]) => {
  if (knownPaths.includes(path)) return path;
  const parts = path.split("/").map(p => p.trim()).filter(Boolean);
  for (let depth = parts.length; depth > 1; depth--) {
    const ancestor = parts.slice(0, depth).join("/");
    if (knownPaths.includes(ancestor)) return ancestor;
  }
  return parts[0];
};

// A plan is only a first anchor: placement and review settle where each claim goes, and a rejected
// claim may leave its scope. So a slip in the plan is repaired, never a reason to stop the upload:
// a repeated claim stays in its first group, a ref from outside this step is dropped, and a scope
// that does not exist falls back to its nearest real one. Omitted refs are returned to plan again.
export function healUploadGroups<G extends {scopePath:string; refs:string[]}>(groups: G[], claims: TopicClaim[], knownPaths: string[]) {
  const expected = new Set(claims.map(c => c.ref!));
  const seen = new Set<string>();
  let repairs = 0;
  const healed = groups.flatMap(group => {
    const scopePath = nearestScope(group.scopePath, knownPaths);
    if (scopePath !== group.scopePath) repairs++;
    if (!scopePath) return [];
    const refs = group.refs.filter(ref => {
      const keep = expected.has(ref) && !seen.has(ref);
      if (keep) seen.add(ref); else repairs++;
      return keep;
    });
    return refs.length ? [{ ...group, scopePath, refs }] : [];
  });
  return { groups: healed, missing: [...expected].filter(ref => !seen.has(ref)), repairs };
}

// Last resort for refs no plan attempt covered: each joins the group of the claim before it, its
// neighbor in the source, and placement and review judge it on its meaning from there.
export function fileOmittedRefs<G extends {refs:string[]}>(groups: G[], claims: TopicClaim[]) {
  const filled = groups.map(group => ({ ...group, refs: [...group.refs] }));
  const owners = new Map(filled.flatMap(group => group.refs.map(ref => [ref, group] as const)));
  let previous = filled[0]!;
  for (const claim of claims) {
    const owner = owners.get(claim.ref!);
    if (owner) previous = owner;
    else previous.refs.push(claim.ref!);
  }
  return filled;
}

// The plan's scope binds the first proposal only. Once review rejects it, a claim may go to its true
// owner outside that scope, or nothing a retry can say would ever satisfy the reviewer.
export function afterReview(input: PlaceTopicsInput, rejected: boolean): PlaceTopicsInput {
  return rejected ? { ...input, scopePath: undefined } : input;
}

export function validateUploadPlacements(placed: Map<string,string[]>, input: PlaceTopicsInput) {
  const missing=input.claims.filter(c=>!placed.has(c.unitId));
  if (missing.length || placed.size !== input.claims.length) throw new Error(`Some knowledge units have no domain assignment. Missing refs: ${missing.map(c=>c.ref).join(", ")}. Return every supplied claim exactly once.`);
  for (const paths of placed.values()) {
    if (paths.some(path => path.split("/").length > 4)) throw new Error("Domain paths may have at most four levels.");
    const scope = input.scopePath;
    if (scope && !paths.some(path => path === scope || path.startsWith(scope+"/"))) throw new Error("Each claim needs a primary assignment inside its planned domain scope.");
    if (scope && paths.some(path => !(path === scope || path.startsWith(scope+"/")) && !input.existingPaths.includes(path))) throw new Error("Secondary assignments outside the scope must use existing domains.");
  }
}

// ONE REQUEST'S SHARE of the upload's evidence: the neighbors its claims nominate or link to,
// those neighbors' domain profiles (examples by neighbor ref, since neighbors carry the text),
// and its own links, candidates and source passages. The whole upload's evidence made a
// book's filing requests grow past 200k tokens.
export function scopedFilingEvidence(evidence: ReturnType<typeof uploadAssignmentEvidence>, refs: ReadonlySet<string>) {
  const candidates = evidence.candidates.filter(c => refs.has(c.ref));
  const links = evidence.links.filter(l => refs.has(l.from) || refs.has(l.to));
  const shown = new Set([...candidates.flatMap(c => c.neighbors.map(n => n.ref)), ...links.flatMap(l => [l.from, l.to])]);
  const neighbors = evidence.neighbors.filter(n => shown.has(n.ref));
  const profiles = evidence.domainProfiles.flatMap(p => {
    const exampleRefs = p.examples.filter(e => shown.has(e.ref)).map(e => e.ref);
    return exampleRefs.length ? [{ path: p.path, totalClaims: p.totalClaims, exampleRefs }] : [];
  });
  return { neighbors, candidates, links, profiles, sourceEvidence: evidence.evidence.filter(e => refs.has(e.ref)) };
}
