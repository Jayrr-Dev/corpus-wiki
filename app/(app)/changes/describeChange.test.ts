import { describe, expect, it } from "vitest";
import type { ChangeContext } from "@/lib/queries/changeContexts";
import { classifyChange, describeChange, EMPTY_CONTEXT } from "./describeChange";

describe("classifyChange", () => {
  it("identifies source lifecycle and approver history", () => {
    expect(classifyChange(["source_lifecycle"])).toBe("source_lifecycle");
    expect(classifyChange(["source_review"])).toBe("source_review");
  });
  it("names a single kind of line edit, and mixed line edits as edits", () => {
    expect(classifyChange(["revise_line"])).toBe("line_rewrite");
    expect(classifyChange(["write_line", "write_line"])).toBe("line_add");
    expect(classifyChange(["retire_line"])).toBe("line_remove");
    expect(classifyChange(["revise_line", "retire_line"])).toBe("line_edit");
  });

  it("lets article, merge and link sets win over their parts", () => {
    expect(classifyChange(["create_page", "create_section"])).toBe("article_new");
    expect(classifyChange(["write_line", "create_section"])).toBe("article_update");
    expect(classifyChange(["merge_duplicates"])).toBe("merge");
    expect(classifyChange(["link", "link"])).toBe("links");
    expect(classifyChange(["revise_line", "revise_claim"])).toBe("line_rewrite");
  });

  it("names claim and catalog changes", () => {
    expect(classifyChange(["create_entity", "add_claim", "link"])).toBe("claim_new");
    expect(classifyChange(["add_claim", "retire_claim"])).toBe("knowledge");
    expect(classifyChange(["update_domain"])).toBe("catalog");
    expect(classifyChange([])).toBe("other");
  });
});

describe("describeChange", () => {
  const context = (overrides: Partial<ChangeContext>): ChangeContext => ({ ...EMPTY_CONTEXT("set"), ...overrides });

  it("names a line rewrite's domain and section and quotes the new line", () => {
    const described = describeChange(
      context({ action_types: ["revise_line"], line_action_count: 1, first_line_content: "Alpha uses  MySQL.", section_titles: ["Facts"], article_titles: ["Alpha"], domain_names: ["Data layer"], domain_paths: ["Projects/Alpha/Data layer"] }),
      'Rewrote 1 line of "Facts"',
    );
    expect(described).toEqual({
      type: "line_rewrite",
      domain: "Data layer",
      domainPath: "Projects/Alpha/Data layer › Alpha",
      section: "Facts",
      summary: "Rewrote 1 line: “Alpha uses MySQL.”",
    });
  });

  it("counts sections across an article update and keeps a summary with no section name", () => {
    const described = describeChange(
      context({ action_types: ["write_line", "create_section"], line_action_count: 1, section_titles: ["Introduction", "Timeline"], article_titles: ["Alpha"], domain_names: ["Data layer"], domain_paths: ["Projects/Alpha/Data layer"] }),
      "Updated article knowledge selections and introduction",
    );
    expect(described).toMatchObject({ type: "article_update", domain: "Data layer", section: "2 sections", summary: null });
  });

  it("names an article outside the domain tree by its title, and new claims by the paths they name", () => {
    expect(describeChange(context({ action_types: ["revise_line"], line_action_count: 1, section_titles: ["Facts"], article_titles: ["Acme"] }), "x")).toMatchObject({ domain: "Acme", domainPath: "Acme" });
    expect(describeChange(context({ action_types: ["add_claim"], claim_domain_paths: ["Safety/PPE"] }), "New")).toMatchObject({ type: "claim_new", domain: "PPE", domainPath: "Safety/PPE", section: null });
    expect(describeChange(context({}), "Nothing")).toMatchObject({ type: "other", domain: null, section: null, summary: null });
  });
});
