import { isContent } from "./nodeTypes";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// RELATEDNESS: derived "similar" links between units that no stored
// relationship connects yet. Each pair of units is scored from what the
// graph already has:
//   - claim text      -> TF-IDF cosine over content words (most weight)
//   - shared entities -> a fixed bonus per entity
//   - domains         -> same domain, or one nested in the other, scaled
//                        by depth (a broad root like "Topics" says little)
// Each unit keeps only its strongest few pairs above the threshold, so
// the graph shows clusters instead of a hairball. Pure and cached per
// graph object, so moving the threshold slider does no rescoring.
// =====================================================================

export interface RelatedOptions {
  // minimum score, 0..1
  threshold: number;
  // strongest pairs kept per unit
  perNode?: number;
}

export interface ScoredPair {
  source: string;
  target: string;
  score: number;
}

// WEIGHTS: text dominates; entities and domains break ties and connect short claims
const TEXT_WEIGHT = 0.7;
const ENTITY_BONUS = 0.15;
const ENTITY_MAX = 0.3;
const DOMAIN_SAME = 0.25;
const DOMAIN_NESTED = 0.12;
// Domains this shallow (1 = a root) carry no signal: everything sits under them
const DOMAIN_MIN_DEPTH = 2;
// Words in more than this share of units are too common to tell units apart
const COMMON_WORD_SHARE = 0.4;
const PER_NODE_DEFAULT = 3;

const STOPWORDS = new Set(
  ("a an and are as at be been by can each for from has have in into is it its may must not of on or our shall should " +
    "such than that the their them then there these they this to under upon was were when where which while who will with " +
    "within without all any also every other only more most per inc ltd llc company employees employee workers worker")
    .split(" "),
);

// Content words of a text: lowercased, punctuation stripped, stopwords and short words dropped, plural "s" folded
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

// TF-IDF vector per unit, unit length, over words that are neither unique nor too common
function textVectors(units: readonly GraphNode[]): Map<string, Map<string, number>> {
  const words = new Map(units.map((unit) => [unit.id, contentWords(unit.text)]));
  const docFreq = new Map<string, number>();
  for (const list of words.values()) for (const word of new Set(list)) docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
  const maxDocs = Math.max(2, units.length * COMMON_WORD_SHARE);
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, list] of words) {
    const vector = new Map<string, number>();
    for (const word of list) {
      const df = docFreq.get(word) ?? 0;
      if (df < 2 || df > maxDocs) continue;
      vector.set(word, (vector.get(word) ?? 0) + Math.log(units.length / df));
    }
    const norm = Math.hypot(...vector.values()) || 1;
    for (const [word, weight] of vector) vector.set(word, weight / norm);
    vectors.set(id, vector);
  }
  return vectors;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [word, weight] of small) sum += weight * (large.get(word) ?? 0);
  return sum;
}

// Domain closeness: the best match between any two of the units' domains
function domainScore(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  for (const pathA of a) {
    for (const pathB of b) {
      const depth = Math.min(pathA.split("/").length, pathB.split("/").length);
      if (depth < DOMAIN_MIN_DEPTH) continue;
      if (pathA === pathB) best = Math.max(best, DOMAIN_SAME);
      else if (pathA.startsWith(`${pathB}/`) || pathB.startsWith(`${pathA}/`)) best = Math.max(best, DOMAIN_NESTED);
    }
  }
  return best;
}

function entityScore(a: readonly string[], b: readonly string[]): number {
  const shared = a.filter((name) => b.includes(name)).length;
  return Math.min(ENTITY_MAX, shared * ENTITY_BONUS);
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Every unit pair with any shared signal, scored 0..1. Candidate pairs come from an
// inverted index (shared word, entity or domain), so unrelated pairs are never compared.
export function scoreRelatedPairs(nodes: readonly GraphNode[]): ScoredPair[] {
  const units = nodes.filter((node) => isContent(node));
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const vectors = textVectors(units);

  const index = new Map<string, string[]>();
  const post = (key: string, id: string) => index.set(key, [...(index.get(key) ?? []), id]);
  for (const unit of units) {
    for (const word of vectors.get(unit.id)?.keys() ?? []) post(`w:${word}`, unit.id);
    for (const name of unit.entityNames) post(`e:${name}`, unit.id);
    // A unit is posted under each of its domains and their ancestors, so nested domains meet
    for (const path of unit.domainPaths) {
      const segments = path.split("/");
      for (let depth = DOMAIN_MIN_DEPTH; depth <= segments.length; depth++) post(`d:${segments.slice(0, depth).join("/")}`, unit.id);
    }
  }

  const seen = new Set<string>();
  const pairs: ScoredPair[] = [];
  for (const ids of index.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!, b = ids[j]!;
        if (a === b) continue;
        const key = pairKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const unitA = byId.get(a)!, unitB = byId.get(b)!;
        const text = cosine(vectors.get(a) ?? new Map(), vectors.get(b) ?? new Map());
        const score = TEXT_WEIGHT * text + entityScore(unitA.entityNames, unitB.entityNames) + domainScore(unitA.domainPaths, unitB.domainPaths);
        if (score > 0) pairs.push({ source: a < b ? a : b, target: a < b ? b : a, score: Math.min(1, score) });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

// Keeps each unit's strongest pairs at or above the threshold, skipping pairs a stored link already joins
export function relatedLinks(data: GraphData, pairs: readonly ScoredPair[], options: RelatedOptions): GraphLink[] {
  const perNode = options.perNode ?? PER_NODE_DEFAULT;
  const linked = new Set(data.links.map((link) => pairKey(link.source, link.target)));
  const kept = new Map<string, number>();
  const links: GraphLink[] = [];
  // Pairs arrive strongest first, so the first `perNode` a unit takes part in are its best
  for (const pair of pairs) {
    if (pair.score < options.threshold) break;
    if (linked.has(pairKey(pair.source, pair.target))) continue;
    const countA = kept.get(pair.source) ?? 0, countB = kept.get(pair.target) ?? 0;
    if (countA >= perNode && countB >= perNode) continue;
    kept.set(pair.source, countA + 1);
    kept.set(pair.target, countB + 1);
    links.push({ id: `similar:${pair.source}:${pair.target}`, source: pair.source, target: pair.target, kind: "similar" });
  }
  return links;
}

// Scored pairs per graph object: the slider only re-thresholds
const pairCache = new WeakMap<GraphData, ScoredPair[]>();

// The graph with derived "similar" links added (unchanged when off)
export function withRelated(data: GraphData, options: RelatedOptions & { show: boolean }): GraphData {
  if (!options.show) return data;
  let pairs = pairCache.get(data);
  if (!pairs) {
    pairs = scoreRelatedPairs(data.nodes);
    pairCache.set(data, pairs);
  }
  return { nodes: data.nodes, links: [...data.links, ...relatedLinks(data, pairs, options)] };
}
