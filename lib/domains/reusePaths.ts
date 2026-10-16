// Resolve spelling variants against siblings only. Never move knowledge between
// organizations, or guess that unrelated topic names mean the same thing.
const words = (name: string) => name.normalize("NFKC").toLowerCase().replaceAll("&", " and ").replace(/[.]/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
function key(name: string): string {
  const value = words(name);
  if (["inspection", "inspections", "quality inspection", "quality inspections"].includes(value)) return "inspections";
  if (["health safety", "health and safety"].includes(value)) return "health and safety";
  return value;
}

export function reuseDomainPaths(existingPaths: readonly string[]): (path: string) => string {
  const siblings = new Map<string, Set<string>>();
  const remember = (parent: string, name: string) => {
    const names = siblings.get(parent) ?? new Set<string>();
    names.add(name);
    siblings.set(parent, names);
  };
  for (const path of existingPaths) {
    let parent = "";
    for (const name of path.split("/").map((part) => part.trim()).filter(Boolean)) {
      remember(parent, name);
      parent = parent ? `${parent}/${name}` : name;
    }
  }
  return (path) => {
    let parent = "";
    for (const requested of path.split("/").map((part) => part.trim()).filter(Boolean)) {
      const names = siblings.get(parent);
      const matches = [...(names ?? [])].filter((name) => key(name) === key(requested));
      // Exact spellings win; ambiguous matches are never silently merged.
      const name = names?.has(requested) ? requested : matches.length === 1 ? matches[0]! : requested;
      remember(parent, name);
      parent = parent ? `${parent}/${name}` : name;
    }
    return parent;
  };
}
