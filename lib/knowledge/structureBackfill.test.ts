import { describe, expect, it } from "vitest";
import { readBackfill, type BackfillClaim } from "./structureBackfill";

const claim: BackfillClaim = { unitId: "u1", content: "EPCOR is wholly owned by the City of Edmonton.", entities: [
  { type: "company", key: "epcor", name: "EPCOR", stakeholder: true },
  { type: "government_body", key: "city-of-edmonton", name: "City of Edmonton", stakeholder: true },
] };
const link = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  from: { type: from === "epcor" ? "company" : "government_body", key: from }, link: "owned_by" as const,
  to: { type: to === "epcor" ? "company" : "government_body", key: to },
  title: null, seniority: null, share: 1, current: true, since: null, until: null, ...extra,
});

describe("readBackfill", () => {
  it("drops links to things that are not stakeholders", () => {
    const withPermit: BackfillClaim = { ...claim, entities: [...claim.entities, { type: "procedure", key: "ula", name: "ULA", stakeholder: false }] };
    const labels = readBackfill({ claims: [{ ref: "C1", links: [{ ...link("epcor", "city-of-edmonton"), to: { type: "procedure", key: "ula" }, link: "works_in" as const }] }] }, [withPermit]);
    expect(labels.get("u1")).toEqual([]);
  });

  it("keeps links between the claim's own entities, once each", () => {
    const labels = readBackfill({ claims: [{ ref: "c1", links: [link("epcor", "city-of-edmonton"), link("epcor", "city-of-edmonton")] }] }, [claim]);
    expect(labels.get("u1")).toEqual([{ from: { type: "company", key: "epcor" }, link: "owned_by", to: { type: "government_body", key: "city-of-edmonton" },
      title: null, seniority: null, share: 1, current: true, since: null, until: null }]);
  });

  it("drops invented ends and self links, bad dates, shares off owned_by, and ends a dated link", () => {
    const labels = readBackfill({ claims: [{ ref: "C1", links: [
      { ...link("epcor", "atco") },
      { ...link("epcor", "epcor") },
      { ...link("epcor", "city-of-edmonton"), link: "contracts_with" as const, since: "last year", until: "2021-03" },
    ] }] }, [claim]);
    expect(labels.get("u1")).toEqual([{ from: { type: "company", key: "epcor" }, link: "contracts_with", to: { type: "government_body", key: "city-of-edmonton" },
      title: null, seniority: null, share: null, current: false, since: null, until: "2021-03" }]);
  });
});
