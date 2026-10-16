import { GRAPH_ACCENTS, GRAPH_COLOR_FAMILIES, splitGroupQuery, type GraphColor, type GraphGroup } from "./groups";

// Topic colors are graph categories, not application status colors.
const THEMES: readonly [RegExp, GraphColor][] = [
  [/\b(safety|health|whmis|wellness)\b/i, "applied"],
  [/\b(quality|inspection|audit|standards)\b/i, "link"],
  [/\b(training|learning|education|onboarding)\b/i, "graph-violet"],
  [/\b(communication|communications|meeting|meetings)\b/i, "graph-teal"],
  [/\b(discipline|conduct|incident|incidents|emergency)\b/i, "graph-rose"],
  [/\b(finance|budget|budgets|billing)\b/i, "stale"],
  [/\b(operations|equipment|maintenance|production)\b/i, "needs-you"],
  [/\b(people|team|hr|culture)\b/i, "graph-pink"],
];
const DISTINCT: GraphColor[] = ["link", "applied", "graph-violet", "needs-you", "graph-teal", "graph-pink", "stale", "graph-cyan", "graph-copper", "graph-lime", "graph-rose", "graph-purple"];

export function chooseDomainColor(path: string, groups: readonly GraphGroup[]): GraphColor {
  const normalized = path.toLowerCase().replace(/\/+$/, "");
  const ancestors = groups.filter((group) => {
    const match = splitGroupQuery(group.query);
    const parent = match.value.trim().toLowerCase().replace(/\/+$/, "");
    return match.field === "domain" && parent && normalized.startsWith(parent + "/");
  }).sort((a, b) => b.query.length - a.query.length);
  const topic = THEMES.find(([pattern]) => pattern.test(normalized.split("/").at(-1)!))?.[1];
  const preferred = topic ?? ancestors[0]?.color;
  const family = GRAPH_COLOR_FAMILIES.find((candidate) => candidate.colors.some(({ token }) => token === preferred));
  const candidates = [...new Set<GraphColor>([
    ...(preferred ? [preferred] : []),
    ...(family ? [family.colors[0]!.token, family.colors[2]!.token, family.colors[1]!.token] : []),
    ...DISTINCT,
    ...GRAPH_ACCENTS.map(({ token }) => token),
    ...GRAPH_COLOR_FAMILIES.flatMap(({ colors }) => colors.map(({ token }) => token)),
  ])].filter((token) => !ancestors.some((ancestor) => ancestor.color === token));
  // Use a fresh shade before repeating one; palette order breaks ties by theme.
  const usage = (token: GraphColor) => groups.filter((group) => group.color === token).length;
  return candidates.reduce((best, token) => usage(token) < usage(best) ? token : best, candidates[0]!);
}

export function themeAutomaticGroups(groups: readonly GraphGroup[]): GraphGroup[] {
  const automatic = groups.filter((group) => group.id === `domain:${splitGroupQuery(group.query).value.trim().toLowerCase()}` && splitGroupQuery(group.query).field === "domain");
  const assigned = groups.filter((group) => !automatic.includes(group));
  const replacements = new Map<string, GraphColor>();
  for (const group of [...automatic].sort((a, b) => a.query.split("/").length - b.query.split("/").length || a.query.localeCompare(b.query))) {
    const color = chooseDomainColor(splitGroupQuery(group.query).value, assigned);
    assigned.push({ ...group, color });
    replacements.set(group.id, color);
  }
  return groups.map((group) => replacements.has(group.id) ? { ...group, color: replacements.get(group.id)! } : group);
}
