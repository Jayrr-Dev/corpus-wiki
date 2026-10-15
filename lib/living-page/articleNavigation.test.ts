import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { articleNavigation, domainArticle } from "./articleNavigation";

const pages = [
  { id: "theme", title: "Safety at Acme", slug: "acme-safety", entity_id: "company", domain_id: null },
  { id: "profile", title: "Acme", slug: "acme", entity_id: null, domain_id: null },
  { id: "ppe", title: "PPE", slug: "ppe", entity_id: null, domain_id: null },
  { id: "other", title: "Unrelated article", slug: "other", entity_id: null, domain_id: null },
];
const entities = [{ id: "company", name: "Acme", aliases: [] }];
const sections = [
  { page_id: "theme", query: { unitIds: ["u1"] } },
  { page_id: "profile", query: { unitIds: ["u1"] } },
  { page_id: "ppe", query: { domainPaths: ["Safety/PPE"], articleAliases: ["Personal protective equipment"] } },
] as Pick<Tables<"sections">, "page_id" | "query">[];

describe("article navigation", () => {
  it("does not resolve a topic to another company's article with the same name", () => {
    const scoped = [
      {...pages[0]!, context_entity_id: "company"},
      {...pages[2]!, id:"other-ppe", slug:"other-ppe", context_entity_id:"other-company"},
      {...pages[2]!, context_entity_id:"company"},
    ];
    const result=articleNavigation(scoped, [{id:"concept",name:"PPE",aliases:[]}], [], "theme", "PPE");
    expect(result.links).toContainEqual({label:"PPE",href:"/p/ppe"});
    expect(result.links.some(link=>link.href==="/p/other-ppe")).toBe(false);
    expect(result.related.some(page=>page.id==="other-ppe")).toBe(false);
  });
  it("links organization names to the profile and concept aliases to real articles", () => {
    const navigation = articleNavigation(pages, entities, sections, "theme", "Acme uses personal protective equipment.");
    expect(navigation.links).toContainEqual({ label: "Acme", href: "/p/acme" });
    expect(navigation.links).toContainEqual({ label: "Personal protective equipment", href: "/p/ppe" });
    expect(navigation.links.every((link) => link.href.startsWith("/p/"))).toBe(true);
    expect(navigation.related.map((page) => page.id).sort()).toEqual(["ppe", "profile"]);
  });

  it("finds a domain's article from its section scope without changing the hierarchy", () => {
    expect(domainArticle(pages, sections, { id: "domain", path: "Safety/PPE" })?.slug).toBe("ppe");
  });
});
