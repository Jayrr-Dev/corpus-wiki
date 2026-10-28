// How one dragged claim changes section claim lists and suggestion groups.
// The graph screen confirms the drop; the server action applies the result.

export type PinnedQuery = {
  unitIds?: string[];
  domainPaths?: string[];
  entity?: unknown;
  kinds?: unknown[];
  articleAliases?: string[];
  article?: boolean;
};

export type ClaimSection = {
  id: string;
  title: string;
  mode: string;
  query: PinnedQuery | null;
  cites: boolean;
};

export type ClaimEdit = {
  id: string;
  title: string;
  query: PinnedQuery;
  fromQuery: PinnedQuery | null;
};

export type SuggestionSection = {
  title: string;
  sectionId: string | null;
  unitIds: string[];
};

export type SuggestionGroup = {
  id: string;
  title: string;
  kind: "create" | "merge";
  unitIds: string[];
  revisionIds: string[];
  sections: SuggestionSection[];
};

export type SuggestionPatch = {
  id: string;
  unitIds: string[];
  revisionIds: string[];
  sections: SuggestionSection[];
  dismiss: boolean;
};

// A section can take one explicit claim when it already lists claims, or when it
// has no topic, entity, or kind filter. Adding unitIds to a filter would hide
// every claim that filter was selecting.
export function canPinClaim(query: PinnedQuery | null | undefined): boolean {
  if (query?.unitIds) return true;
  return !hasBroadFilter(query);
}

function hasBroadFilter(query: PinnedQuery | null | undefined): boolean {
  if (!query) return false;
  return Boolean(
    query.domainPaths?.length ||
    query.entity ||
    query.kinds?.length ||
    query.articleAliases?.length,
  );
}

function listsUnit(query: PinnedQuery | null, unitId: string): boolean {
  return query?.unitIds?.includes(unitId) ?? false;
}

// Destination null means the claim is leaving articles for a suggestion.
// Holders are the other sections that cite it or list it.
export function placeClaimEdits(
  unitId: string,
  destination: ClaimSection | null,
  holders: readonly ClaimSection[],
): { edits: ClaimEdit[]; refreshIds: string[] } | { error: string } {
  const edits: ClaimEdit[] = [];
  const refreshIds: string[] = [];
  for (const section of holders) {
    if (destination && section.id === destination.id) continue;
    if (section.mode !== "generated") {
      return {
        error: `"${section.title}" is handwritten, so this knowledge cannot be moved out of it.`,
      };
    }
    if (listsUnit(section.query, unitId)) {
      const nextIds = section.query!.unitIds!.filter((id) => id !== unitId);
      edits.push({
        id: section.id,
        title: section.title,
        query: { ...section.query, unitIds: nextIds },
        fromQuery: section.query,
      });
      if (section.cites) refreshIds.push(section.id);
      continue;
    }
    if (hasBroadFilter(section.query)) {
      return {
        error: `"${section.title}" gathers this knowledge by topic, so it cannot be moved out.`,
      };
    }
    if (section.cites) refreshIds.push(section.id);
  }
  if (!destination) return { edits, refreshIds };
  if (destination.mode !== "generated") {
    return { error: "Only a generated section can take a dragged claim." };
  }
  if (!canPinClaim(destination.query)) {
    return {
      error: `"${destination.title}" gathers claims by topic, so one claim cannot be dropped in.`,
    };
  }
  const current = destination.query?.unitIds ?? [];
  const already = current.includes(unitId);
  if (!already) {
    edits.push({
      id: destination.id,
      title: destination.title,
      query: { ...(destination.query ?? {}), unitIds: [...current, unitId] },
      fromQuery: destination.query,
    });
  }
  if (!already || !destination.cites) refreshIds.push(destination.id);
  if (
    already &&
    destination.cites &&
    edits.length === 0 &&
    refreshIds.length === 0
  ) {
    return { error: "This knowledge is already in that section." };
  }
  return { edits, refreshIds };
}

function readSections(value: unknown): SuggestionSection[] {
  if (!Array.isArray(value))
    throw new Error("This suggestion has no sections.");
  return value.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("This suggestion has no sections.");
    const row = item as {
      title?: unknown;
      sectionId?: unknown;
      unitIds?: unknown;
    };
    if (typeof row.title !== "string" || !Array.isArray(row.unitIds)) {
      throw new Error("This suggestion has no sections.");
    }
    return {
      title: row.title,
      sectionId: typeof row.sectionId === "string" ? row.sectionId : null,
      unitIds: row.unitIds.filter((id): id is string => typeof id === "string"),
    };
  });
}

function withoutUnit(
  sections: readonly SuggestionSection[],
  unitId: string,
): SuggestionSection[] {
  return sections
    .map((section) => ({
      ...section,
      unitIds: section.unitIds.filter((id) => id !== unitId),
    }))
    .filter((section) => section.unitIds.length > 0);
}

function withUnit(
  sections: readonly SuggestionSection[],
  unitId: string,
): SuggestionSection[] {
  if (sections.some((section) => section.unitIds.includes(unitId)))
    return [...sections];
  const [first, ...rest] = sections;
  if (!first)
    return [{ title: "Overview", sectionId: null, unitIds: [unitId] }];
  return [{ ...first, unitIds: [...first.unitIds, unitId] }, ...rest];
}

// Moves one claim between pending suggestion groups. A group with nothing left is dismissed.
export function suggestionMembership(
  groups: readonly SuggestionGroup[],
  unitId: string,
  revisionId: string,
  target: { title: string; merge: boolean },
): SuggestionPatch[] {
  const wanted = target.merge ? "merge" : "create";
  const matches = groups.filter(
    (group) => group.title === target.title && group.kind === wanted,
  );
  if (matches.length === 0)
    throw new Error("That suggestion is no longer pending.");
  if (matches.length > 1)
    throw new Error("More than one suggestion uses that title.");
  const destination = matches[0]!;
  const patches: SuggestionPatch[] = [];
  for (const group of groups) {
    if (group.unitIds.length !== group.revisionIds.length) {
      throw new Error("This suggestion is out of date. Run suggestions again.");
    }
    const index = group.unitIds.indexOf(unitId);
    if (group.id === destination.id) {
      if (index >= 0) continue;
      patches.push({
        id: group.id,
        unitIds: [...group.unitIds, unitId],
        revisionIds: [...group.revisionIds, revisionId],
        sections: withUnit(group.sections, unitId),
        dismiss: false,
      });
      continue;
    }
    if (index < 0) continue;
    const unitIds = group.unitIds.filter((id) => id !== unitId);
    const revisionIds = group.revisionIds.filter((_, at) => at !== index);
    patches.push({
      id: group.id,
      unitIds,
      revisionIds,
      sections: withoutUnit(group.sections, unitId),
      dismiss: unitIds.length === 0,
    });
  }
  if (!patches.length)
    throw new Error("This knowledge is already in that suggestion.");
  return patches;
}

export function suggestionSections(value: unknown): SuggestionSection[] {
  return readSections(value);
}

// Takes one claim out of every pending suggestion that lists it.
export function releaseSuggestionUnit(
  groups: readonly SuggestionGroup[],
  unitId: string,
): SuggestionPatch[] {
  const patches: SuggestionPatch[] = [];
  for (const group of groups) {
    const index = group.unitIds.indexOf(unitId);
    if (index < 0) continue;
    if (group.unitIds.length !== group.revisionIds.length) {
      throw new Error("This suggestion is out of date. Run suggestions again.");
    }
    const unitIds = group.unitIds.filter((id) => id !== unitId);
    patches.push({
      id: group.id,
      unitIds,
      revisionIds: group.revisionIds.filter((_, at) => at !== index),
      sections: withoutUnit(group.sections, unitId),
      dismiss: unitIds.length === 0,
    });
  }
  return patches;
}
