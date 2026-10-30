import { describe, expect, it } from "vitest";
import { applyOutlineEdits, type DocOutline, fallbackOutline, mergeThinPages, movePage, normalizeOutline, outlineUnitIds } from "./outline";

const proposed: DocOutline = {
  title: " Cluster  docs ",
  pages: [
    { title: "Delete a cluster", group: "remove", introUnitIds: [], sections: [{ title: "Delete", unitIds: ["d"] }] },
    { title: "Create a cluster", group: "set_up", introUnitIds: ["a"], sections: [{ title: "Create", unitIds: ["b", "outside"] }, { title: "Empty", unitIds: ["outside"] }] },
    { title: "Connect", group: "use", introUnitIds: [], sections: [{ title: "Connect", unitIds: ["c", "b"] }] },
    { title: "create a cluster", group: "use", introUnitIds: [], sections: [{ title: "Again", unitIds: ["e"] }] },
    { title: "Nothing", group: "change", introUnitIds: ["outside"], sections: [] },
  ],
};

describe("normalizeOutline", () => {
  it("groups pages by task: set up, use, change, remove", () => {
    const outline = normalizeOutline(proposed, ["a", "b", "c", "d", "e"]);
    expect(outline.title).toBe("Cluster docs");
    expect(outline.pages.map((page) => page.title)).toEqual(["Create a cluster", "Connect", "Delete a cluster"]);
  });

  it("uses each scope claim once and drops empty tasks, empty pages and repeated titles", () => {
    const outline = normalizeOutline(proposed, ["a", "b", "c", "d", "e"]);
    const create = outline.pages[0]!;
    expect(create.sections).toEqual([{ title: "Create", unitIds: ["b"] }]);
    // "b" went to the page proposed first; Connect keeps only "c"
    expect(outline.pages[1]!.sections).toEqual([{ title: "Connect", unitIds: ["c"] }]);
    expect(outlineUnitIds(outline).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("turns a page that has only intro claims into one task, so it is written as steps", () => {
    const outline = normalizeOutline({ title: "Docs", pages: [{ title: "Ventilate the space", group: "set_up", introUnitIds: ["a"], sections: [] }] }, ["a"]);
    expect(outline.pages[0]).toMatchObject({ introUnitIds: [], sections: [{ title: "Ventilate the space", unitIds: ["a"] }] });
  });

  it("falls back to a title when the model gives none", () => {
    expect(normalizeOutline({ title: " ", pages: [] }, [], "Topic › Clusters").title).toBe("Topic › Clusters");
  });
});

describe("outline edits", () => {
  const outline = normalizeOutline(proposed, ["a", "b", "c", "d", "e"]);

  it("renames, reorders and drops pages, keeping each page's claims", () => {
    const edited = applyOutlineEdits(outline, [{ index: 2, title: "Remove a cluster" }, { index: 0, title: "  " }]);
    expect(edited.pages.map((page) => page.title)).toEqual(["Remove a cluster", "Create a cluster"]);
    expect(edited.pages[0]!.sections[0]!.unitIds).toEqual(["d"]);
  });

  it("ignores unknown and repeated pages", () => {
    expect(applyOutlineEdits(outline, [{ index: 9, title: "x" }, { index: 1, title: "A" }, { index: 1, title: "B" }]).pages.map((page) => page.title)).toEqual(["A"]);
  });

  it("moves a page up or down within bounds", () => {
    const edits = [{ index: 0, title: "a" }, { index: 1, title: "b" }];
    expect(movePage(edits, 1, -1).map((edit) => edit.index)).toEqual([1, 0]);
    expect(movePage(edits, 0, -1)).toBe(edits);
  });
});

describe("mergeThinPages", () => {
  const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
  const page = (title: string, intro: string[], unitIds: string[]) => ({ title, group: "use" as const, introUnitIds: intro, sections: [{ title: `${title} task`, unitIds }] });

  it("turns one-line pages into one page, each old page a task with its claims in order", () => {
    const outline = mergeThinPages({ title: "Confined spaces", pages: [page("Understand", ["a"], ["b"]), page("Prepare", ["c"], ["d"]), page("Respond", [], ["e"])] });
    expect(outline.pages).toEqual([{ title: "Confined spaces", group: "use", introUnitIds: ["a"], sections: [
      { title: "Understand", unitIds: ["b"] },
      { title: "Prepare", unitIds: ["c", "d"] },
      { title: "Respond", unitIds: ["e"] },
    ] }]);
  });

  it("keeps pages that have enough to say, a single page, and merges that would need too many tasks", () => {
    const full = { title: "Clusters", pages: [page("Create", [], ids("c", 4)), page("Delete", [], ids("d", 4))] };
    expect(mergeThinPages(full)).toBe(full);
    const single = { title: "One", pages: [page("Only", [], ["a"])] };
    expect(mergeThinPages(single)).toBe(single);
    const many = { title: "Many", pages: ids("p", 9).map((id) => page(id, [], [id])) };
    expect(mergeThinPages(many)).toBe(many);
  });
});

describe("fallbackOutline", () => {
  it("makes one page: an intro claim, then tasks of up to six claims", () => {
    const ids = Array.from({ length: 9 }, (_, index) => `u${index}`);
    const outline = fallbackOutline("Clusters", ids);
    expect(outline.pages).toHaveLength(1);
    expect(outline.pages[0]!.introUnitIds).toEqual(["u0"]);
    expect(outline.pages[0]!.sections.map((section) => section.unitIds.length)).toEqual([6, 2]);
    expect(fallbackOutline("Empty", []).pages).toEqual([]);
  });
});
