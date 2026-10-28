import { describe, expect, it } from "vitest";
import {
  placeClaimEdits,
  releaseSuggestionUnit,
  suggestionMembership,
  type ClaimSection,
  type SuggestionGroup,
} from "./pageDrop";

const section = (
  patch: Partial<ClaimSection> & Pick<ClaimSection, "id">,
): ClaimSection => ({
  title: patch.id,
  mode: "generated",
  query: { unitIds: [patch.id] },
  cites: false,
  ...patch,
});

const group = (
  patch: Partial<SuggestionGroup> &
    Pick<SuggestionGroup, "id" | "title" | "kind">,
): SuggestionGroup => ({
  unitIds: [],
  revisionIds: [],
  sections: [{ title: "Overview", sectionId: null, unitIds: [] }],
  ...patch,
});

describe("placeClaimEdits", () => {
  it("adds a claim to the destination and removes it from the section that listed it", () => {
    const destination = section({
      id: "dest",
      title: "Notes",
      query: { article: true, unitIds: ["other"] },
      cites: true,
    });
    const source = section({
      id: "source",
      title: "Facts",
      query: { unitIds: ["moved", "kept"] },
      cites: true,
    });
    expect(placeClaimEdits("moved", destination, [source])).toEqual({
      edits: [
        {
          id: "source",
          title: "Facts",
          query: { unitIds: ["kept"] },
          fromQuery: source.query,
        },
        {
          id: "dest",
          title: "Notes",
          query: { article: true, unitIds: ["other", "moved"] },
          fromQuery: destination.query,
        },
      ],
      refreshIds: ["source", "dest"],
    });
  });

  it("refuses a topic filter that would keep the claim, and a topic section that cannot take one claim", () => {
    const broad = section({
      id: "broad",
      query: { entity: { type: "org", key: "acme" } },
      cites: true,
    });
    expect(placeClaimEdits("moved", null, [broad])).toEqual({
      error:
        '"broad" gathers this knowledge by topic, so it cannot be moved out.',
    });
    const destination = section({
      id: "dest",
      query: { domainPaths: ["Co"] },
      cites: false,
    });
    const refused = placeClaimEdits("moved", destination, []);
    expect("error" in refused ? refused.error : "").toBe(
      '"dest" gathers claims by topic, so one claim cannot be dropped in.',
    );
  });

  it("says when the claim is already in that section", () => {
    const destination = section({
      id: "dest",
      query: { unitIds: ["moved"] },
      cites: true,
    });
    expect(placeClaimEdits("moved", destination, [])).toEqual({
      error: "This knowledge is already in that section.",
    });
  });
});

describe("suggestion membership", () => {
  it("moves a claim from a new-article group into a merge and dismisses the empty group", () => {
    const create = group({
      id: "create",
      title: "Wings",
      kind: "create",
      unitIds: ["moved"],
      revisionIds: ["rev"],
      sections: [{ title: "Overview", sectionId: null, unitIds: ["moved"] }],
    });
    const merge = group({
      id: "merge",
      title: "Centers",
      kind: "merge",
      unitIds: ["kept"],
      revisionIds: ["kept-rev"],
      sections: [{ title: "Facts", sectionId: "s1", unitIds: ["kept"] }],
    });
    expect(
      suggestionMembership([create, merge], "moved", "rev-now", {
        title: "Centers",
        merge: true,
      }),
    ).toEqual([
      {
        id: "create",
        unitIds: [],
        revisionIds: [],
        sections: [],
        dismiss: true,
      },
      {
        id: "merge",
        unitIds: ["kept", "moved"],
        revisionIds: ["kept-rev", "rev-now"],
        sections: [
          { title: "Facts", sectionId: "s1", unitIds: ["kept", "moved"] },
        ],
        dismiss: false,
      },
    ]);
    expect(releaseSuggestionUnit([merge], "kept")).toEqual([
      {
        id: "merge",
        unitIds: [],
        revisionIds: [],
        sections: [],
        dismiss: true,
      },
    ]);
  });
});
