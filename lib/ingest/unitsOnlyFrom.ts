// A current unit and the passages its current revision cites
export type CitedUnit = { id: string; revisionId: string; passageIds: readonly string[] };

// UNITS ONLY THIS FILE SUPPORTS: every cited passage is one of the file's.
// A unit with no evidence (a person's own claim) is never one of them.
export function unitsOnlyFrom(filePassageIds: ReadonlySet<string>, units: readonly CitedUnit[]): CitedUnit[] {
  return units
    .filter((unit) => unit.passageIds.length > 0 && unit.passageIds.every((id) => filePassageIds.has(id)));
}

// A unit that cites the file AND other evidence, with the citations left once the file goes
export type SharedUnit<U extends CitedUnit = CitedUnit> = U & { remainingPassageIds: string[] };

// UNITS THIS FILE SHARES WITH OTHER EVIDENCE: some, but not all, citations are the file's
export function unitsPartlyFrom<U extends CitedUnit>(filePassageIds: ReadonlySet<string>, units: readonly U[]): SharedUnit<U>[] {
  return units.flatMap((unit) => {
    const remainingPassageIds = unit.passageIds.filter((id) => !filePassageIds.has(id));
    const citesFile = remainingPassageIds.length < unit.passageIds.length;
    return citesFile && remainingPassageIds.length > 0 ? [{ ...unit, remainingPassageIds }] : [];
  });
}
