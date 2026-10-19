// Several claims often cite the same source passage. Send the passage once,
// keeping every claim-to-passage link and the full text for independent review.
export function compactFilingEvidence(context: unknown): unknown {
  if (!context || typeof context !== "object" || Array.isArray(context)) return context;
  const value = context as Record<string, unknown>;
  if (!Array.isArray(value.sourceEvidence)) return context;
  const passages: { ref: string; location: unknown; text: string }[] = [];
  const byContent = new Map<string, string>();
  const sourceEvidence = value.sourceEvidence.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const evidence = entry as Record<string, unknown>;
    if (!Array.isArray(evidence.passages)) return entry;
    return { ...evidence, passages: evidence.passages.map((passage: unknown) => {
      if (!passage || typeof passage !== "object" || Array.isArray(passage)) return passage;
      const source = passage as Record<string, unknown>;
      if (typeof source.text !== "string") return passage;
      const key = JSON.stringify([source.location ?? null, source.text]);
      let ref = byContent.get(key);
      if (!ref) {
        ref = `P${passages.length + 1}`;
        byContent.set(key, ref);
        passages.push({ ref, location: source.location ?? null, text: source.text });
      }
      const metadata = Object.fromEntries(Object.entries(source).filter(([name]) => name !== "text" && name !== "location"));
      return { ...metadata, passageRef: ref };
    }) };
  });
  const compact = { ...value, sourceEvidence, sourcePassages: passages };
  return JSON.stringify(compact).length < JSON.stringify(context).length ? compact : context;
}

export function compactPreviousPlacements(placements: { ref: string; domainPaths: string[] }[] | undefined) {
  if (!placements?.length) return { previousPlacements: placements };
  const paths = new Map<string,string>();
  const previousPlacements = placements.map(({ ref,domainPaths }) => ({ ref,domainRefs:domainPaths.map(path=>{
    let id=paths.get(path);
    if (!id) { id=`D${paths.size+1}`;paths.set(path,id); }
    return id;
  }) }));
  const compact={previousPlacements,previousDomains:[...paths].map(([path,ref])=>({ref,path}))};
  return JSON.stringify(compact).length<JSON.stringify({previousPlacements:placements}).length ? compact : {previousPlacements:placements};
}

// EARLIER BATCHES' FILING, one entry per destination: its path, how many claims went there and
// a few of their titles. Listing every earlier claim grew each request by the whole upload.
export function filedDestinations(placements: { title: string; domainPaths: string[] }[], examples = 3) {
  const titles = new Map<string, string[]>();
  for (const placement of placements) for (const path of placement.domainPaths) titles.set(path, [...titles.get(path) ?? [], placement.title]);
  return [...titles].sort(([a], [b]) => a.localeCompare(b)).map(([path, list]) => ({ path, claims: list.length, examples: list.slice(-examples) }));
}

// At most `cap` earlier claims per current destination, the latest filed first kept, in filing order
export function sampleDestinationClaims<T extends { domainPaths?: string[] }>(claims: T[], destinations: ReadonlySet<string>, cap: number): T[] {
  const counts = new Map<string, number>();
  const kept = new Set<T>();
  for (const claim of [...claims].reverse()) {
    const paths = (claim.domainPaths ?? []).filter(path => destinations.has(path) && (counts.get(path) ?? 0) < cap);
    if (!paths.length) continue;
    kept.add(claim);
    for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return claims.filter(claim => kept.has(claim));
}
