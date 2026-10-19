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
