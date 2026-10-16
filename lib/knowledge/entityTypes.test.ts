import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTEXT_OWNER_TYPES, ENTITY_TYPE_LIST, ENTITY_TYPES, normalizeEntityType, typeIsOrganization, typeIsStakeholder, typeOwnsContext } from "./entityTypes";

describe("entity types", () => {
  it("keeps every listed type on the list", () => {
    for (const type of ENTITY_TYPES) expect(normalizeEntityType(type)).toBe(type);
  });

  it("maps the words older answers used onto the list", () => {
    expect(normalizeEntityType("Country")).toBe("place");
    expect(normalizeEntityType("law")).toBe("legislation");
    expect(normalizeEntityType("Regulations")).toBe("legislation");
    expect(normalizeEntityType("agency")).toBe("government_body");
    expect(normalizeEntityType("government-body")).toBe("government_body");
    expect(normalizeEntityType("companies")).toBe("company");
    expect(normalizeEntityType("software")).toBe("tool");
    expect(normalizeEntityType("template")).toBe("document");
  });

  it("falls back to concept for anything else", () => {
    expect(normalizeEntityType("widget")).toBe("concept");
    expect(normalizeEntityType("")).toBe("concept");
    expect(normalizeEntityType(undefined)).toBe("concept");
  });

  it("decides stakeholders by type, leaving concept undecided", () => {
    expect(typeIsStakeholder("company")).toBe(true);
    expect(typeIsStakeholder("standard")).toBe(false);
    expect(typeIsStakeholder("concept")).toBeNull();
  });

  it("matches the rows the migration seeds", () => {
    const sql = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "migrations", "20261111100000_entity_types.sql"), "utf8");
    const seeded = [...sql.matchAll(/^\s*\('([a-z_]+)', (null|'[a-z_]+'), '[^']*', '[^']*', (true|false), (true|false), \d+\)/gm)]
      .filter((row) => row[4] === "true")
      .map((row) => ({ type: row[1], parent: row[2] === "null" ? null : row[2]!.slice(1, -1), stakeholder: row[3] === "true" }));
    expect(seeded).toEqual(ENTITY_TYPE_LIST.map(({ type, parent, stakeholder }) => ({ type, parent, stakeholder })));
  });
});

describe("context owners", () => {
  it("matches the types the migration marks as owning context", () => {
    const sql = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "migrations", "20261111110000_context_owner_types.sql"), "utf8");
    const marked = /set owns_context = true\s+where type in \(([^)]*)\)/.exec(sql)![1]!.split(",").map((word) => word.trim().slice(1, -1));
    expect([...marked].sort()).toEqual([...CONTEXT_OWNER_TYPES].sort());
  });

  it("counts every kind of organization, including government bodies", () => {
    expect(typeOwnsContext("government_body")).toBe(true);
    expect(typeOwnsContext("standard")).toBe(false);
    expect(["company", "government_body", "organization"].every(typeIsOrganization)).toBe(true);
    expect(typeIsOrganization("project")).toBe(false);
  });
});
