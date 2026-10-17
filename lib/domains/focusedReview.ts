import { clusterEvidence, type DecisionSnapshot, type DomainConnection, type domainDecisionSchema } from "./decider";
import type { z } from "zod";
import { createHash } from "node:crypto";

export function domainReviewKey(snapshot: DecisionSnapshot, connections: DomainConnection[], path: string) {
  const domains = snapshot.domains.filter(d => !d.retired_at && (d.path === path || d.path.startsWith(path + "/")));
  const domainIds = new Set(domains.map(d => d.id));
  const memberships = snapshot.unitDomains.filter(m => domainIds.has(m.domain_id));
  const ids = new Set(memberships.map(m => m.unit_id));
  const evidence = [domains.map(d => [d.id,d.path]).sort(), memberships.map(m => [m.unit_id,m.domain_id]).sort(), snapshot.claims.filter(c => ids.has(c.id)).map(c => [c.id,c.revisionId,c.retiredAt]).sort(), connections.filter(c => ids.has(c.from) || ids.has(c.to)).map(c => [c.from,c.type,c.to]).sort()];
  return path + "|" + createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

// Ranking is local; only the selected domain and its neighbors reach the model.
export function focusedReview(snapshot: DecisionSnapshot, vectors: Map<string, number[]>, connections: DomainConnection[], reviewed: string[], targetPath = "") {
  const all = clusterEvidence(snapshot, vectors, connections);
  if (targetPath && !all.domains.some(d => d.path === targetPath)) throw new Error("The selected domain no longer exists. Choose its current path.");
  const ranked = all.domains.filter(d => (targetPath ? d.path === targetPath : all.mustReview.includes(d.path)) && !reviewed.includes(d.path) && !reviewed.includes(domainReviewKey(snapshot,connections,d.path)) && reviewed.filter(key => key.startsWith(d.path + "|")).length < 3).map(domain => {
    const groups = all.candidates.filter(c => c.path === domain.path);
    const largest = Math.min(domain.independentIdeasEstimate, Math.max(0, ...groups.map(c => c.claims.length)));
    return { ...domain, priority: largest * 10 + domain.independentIdeasEstimate + Math.min(20, groups.reduce((sum, c) => sum + c.links, 0)) };
  }).sort((a,b) => b.priority - a.priority || a.path.localeCompare(b.path));
  const target = ranked[0];
  if (!target) return null;
  const local = new Set(all.domains.filter(d => d.path === target.path || d.path.startsWith(target.path + "/")).map(d => d.path));
  const writable = new Set(local);
  const directRefs = new Set(all.candidates.filter(c => local.has(c.path)).flatMap(c => c.claims));
  // Include all local claims, including small groups that are not candidates.
  for (const cluster of all.clusters) for (const claim of cluster.claims) if (claim.domains.some(ref => all.domains.some(d => d.ref === ref && local.has(d.path)))) directRefs.add(claim.ref);
  const neighborScores = new Map<string, number>();
  for (const cluster of all.clusters) {
    if (!cluster.claims.some(c => directRefs.has(c.ref))) continue;
    for (const claim of cluster.claims) for (const ref of claim.domains) {
      const domain = all.domains.find(d => d.ref === ref);
      if (domain && !local.has(domain.path) && domain.path.split("/")[0] === target.path.split("/")[0]) neighborScores.set(domain.path, (neighborScores.get(domain.path) ?? 0) + 1);
    }
  }
  for (const [a,,b] of all.links) {
    const other = directRefs.has(a) ? b : directRefs.has(b) ? a : null;
    if (!other) continue;
    for (const claim of all.clusters.flatMap(c => c.claims).filter(c => c.ref === other)) for (const ref of claim.domains) {
      const domain = all.domains.find(d => d.ref === ref);
      if (domain && !local.has(domain.path) && domain.path.split("/")[0] === target.path.split("/")[0]) neighborScores.set(domain.path, (neighborScores.get(domain.path) ?? 0) + 3);
    }
  }
  const adjacent = new Set([...neighborScores].sort((a,b) => b[1]-a[1]).slice(0,3).map(([path]) => path));
  const catalog = all.domains.filter(d => local.has(d.path) || adjacent.has(d.path) || target.path.startsWith(d.path + "/"));
  const visibleRefs = new Set(catalog.map(d => d.ref));
  const clusters = all.clusters.map(c => ({ ref:c.ref, claims: c.claims.filter(claim => claim.domains.some(ref => visibleRefs.has(ref))) })).filter(c => c.claims.length).map(c => ({ ...c, size: c.claims.length }));
  const included = new Set(clusters.flatMap(c => c.claims.map(claim => claim.ref)));
  return { target, reviewKey: domainReviewKey(snapshot,connections,target.path), remaining: ranked.length, writable, destinations: new Set(targetPath ? local : catalog.map(d => d.path)), claimRefs: directRefs,
    context: { target: target.path, writablePaths:[...writable], destinationPaths:targetPath ? [...local] : catalog.map(d => d.path), readOnlyPaths:catalog.filter(d => !writable.has(d.path)).map(d => d.path), remainingDomains: ranked.length, domains: catalog, candidates: all.candidates.filter(c => c.path === target.path), mustReview: catalog.filter(d => local.has(d.path)).map(d => d.path), clusters, links: all.links.filter(([a,,b]) => included.has(a) && included.has(b)) } };
}

export function validateFocusedReview(review: z.infer<typeof domainDecisionSchema>, scope: NonNullable<ReturnType<typeof focusedReview>>) {
  const writable = new Set(scope.writable), destinations = new Set(scope.destinations);
  for (const op of review.operations) {
    if (op.sourcePath && !writable.has(op.sourcePath)) throw new Error("Review may only change its selected domain and descendants.");
    if (op.destinationPath && !destinations.has(op.destinationPath)) throw new Error(`Destination ${op.destinationPath} is outside the reviewed neighborhood of ${scope.target.path}. Use only destinationPaths or subdomains created inside the target.`);
    if (op.claimIds.some(ref => !scope.claimRefs.has(ref))) throw new Error("Neighboring claims are context only and cannot be changed in this pass.");
    if (op.operation === "assign" && !op.sourcePath) throw new Error("Focused reviews cannot assign unrelated unfiled claims.");
    if (op.operation === "create") {
      if (!writable.has(op.destinationPath!)) throw new Error("Create subdomains only inside the selected domain.");
      const processName = (name: string) => /\b(process|procedure|steps)\b/i.test(name);
      if (processName(op.name ?? "")) {
        const existing = [...writable].find(path => path.slice(0,path.lastIndexOf("/")) === op.destinationPath && processName(path.split("/").at(-1)!));
        if (existing) throw new Error(`A process child already exists: ${existing}. Read its claims, rename it if misleading, and reuse it instead of creating a parallel process branch.`);
      }
      const path = op.destinationPath + "/" + op.name; writable.add(path); destinations.add(path);
    }
    if (op.operation === "rename" || op.operation === "move") {
      const next = op.operation === "rename" ? op.sourcePath!.slice(0,op.sourcePath!.lastIndexOf("/")+1)+op.name : op.destinationPath + "/" + op.sourcePath!.split("/").at(-1);
      for (const path of [...writable]) if (path === op.sourcePath || path.startsWith(op.sourcePath + "/")) { const replacement = next + path.slice(op.sourcePath!.length); writable.add(replacement); destinations.add(replacement); }
    }
  }
}
