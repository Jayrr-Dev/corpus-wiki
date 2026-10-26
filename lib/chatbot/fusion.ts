// Reciprocal rank fusion: each list adds 1 / (k + rank) to every id it holds, rank starting at 1.
// An id that several lists agree on beats one that a single list puts first.
export function reciprocalRankFusion(lists: string[][], options: { k?: number; cap?: number } = {}): string[] {
  const k = options.k ?? 60;
  const cap = options.cap && options.cap > 0 ? options.cap : undefined;
  // Map order is first appearance, which the stable sort keeps as the last tie-break
  const scores = new Map<string, { score: number; best: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    // The cap applies before duplicates are dropped, so a list never contributes past its cap
    for (const [index, id] of (cap ? list.slice(0, cap) : list).entries()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const rank = index + 1;
      const entry = scores.get(id);
      if (entry) { entry.score += 1 / (k + rank); entry.best = Math.min(entry.best, rank); }
      else scores.set(id, { score: 1 / (k + rank), best: rank });
    }
  }
  return [...scores].sort(([, a], [, b]) => b.score - a.score || a.best - b.best).map(([id]) => id);
}
