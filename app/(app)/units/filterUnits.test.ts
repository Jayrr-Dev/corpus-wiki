import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { filterUnits, readUnitFilters, type UnitJoins } from "./filterUnits";

// SEED-LIKE ROWS: Projects/Alpha with a Planning child
const DOMAINS = [
  { id: "d-alpha", path: "Projects/Alpha" },
  { id: "d-plan", path: "Projects/Alpha/Planning" },
  { id: "d-db", path: "Topics/Databases" },
] as Tables<"domains">[];

function unit(id: string, extra: Partial<UnitSummary> = {}): UnitSummary {
  return { id, kind: "fact", epistemic_status: "supported", retired_at: null, content: id, ...extra } as UnitSummary;
}

const UNITS = [unit("u1"), unit("u2", { kind: "decision" }), unit("u3", { retired_at: "2026-09-01T00:00:00Z" })];

const JOINS: UnitJoins = {
  domains: DOMAINS,
  unitDomains: [
    { unit_id: "u1", domain_id: "d-alpha" },
    { unit_id: "u2", domain_id: "d-plan" },
    { unit_id: "u3", domain_id: "d-db" },
  ],
  unitEntities: [{ unit_id: "u2", entity_id: "e1", role: "subject" }],
};

// Filters from a query string
function filters(query: string) {
  return readUnitFilters(new URLSearchParams(query));
}

describe("filterUnits", () => {
  it("shows current units by default", () => {
    expect(filterUnits(UNITS, filters(""), JOINS).map((u) => u.id)).toEqual(["u1", "u2"]);
  });

  it("includes child domains when filtering by a domain", () => {
    expect(filterUnits(UNITS, filters("domain=d-alpha"), JOINS).map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(filterUnits(UNITS, filters("domain=d-plan"), JOINS).map((u) => u.id)).toEqual(["u2"]);
  });

  it("filters by kind, entity and retired state", () => {
    expect(filterUnits(UNITS, filters("kind=decision"), JOINS).map((u) => u.id)).toEqual(["u2"]);
    expect(filterUnits(UNITS, filters("entity=e1"), JOINS).map((u) => u.id)).toEqual(["u2"]);
    expect(filterUnits(UNITS, filters("state=retired"), JOINS).map((u) => u.id)).toEqual(["u3"]);
    expect(filterUnits(UNITS, filters("state=all"), JOINS)).toHaveLength(3);
  });
});
