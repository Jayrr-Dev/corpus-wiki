// A current unit and the passages its current revision cites
export type CitedUnit = { id: string; revisionId: string; passageIds: readonly string[] };

// UNITS ONLY THIS FILE SUPPORTS: every cited passage is one of the file's.
// A unit with no evidence (a person's own claim) is never one of them.
export function unitsOnlyFrom(filePassageIds: ReadonlySet<string>, units: readonly CitedUnit[]): CitedUnit[] {
  return units
    .filter((unit) => unit.passageIds.length > 0 && unit.passageIds.every((id) => filePassageIds.has(id)));
}
