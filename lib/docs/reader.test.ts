import { describe, expect, it } from "vitest";
import { serializeDocBlock } from "./blocks";
import { docSetExportFiles } from "./markdown";
import { claimsByUnit, pageHeadings, pageTree, readerSections } from "./reader";
import { type DocPageRow, isPageStale, isPageUnwritten, isPageWriting } from "./types";

const page: DocPageRow = {
  id: "11111111-page", title: "Managing clusters", slug: "managing-clusters", position: 0, group: "change",
  sections: [
    { id: "aaaaaaaa-intro", title: "Introduction", intro: true, status: "current", builtAt: "2026-10-01T00:00:00Z", lines: [
      { lineId: "l-intro-0001", content: serializeDocBlock({ type: "text", text: "A cluster is a group of hosts.", cites: ["u1"] }), unitRevisionIds: ["r1"], isStale: false },
    ] },
    { id: "bbbbbbbb-task", title: "Change a cluster", intro: false, status: "current", builtAt: "2026-10-01T00:00:00Z", lines: [
      { lineId: "l-head-00001", content: serializeDocBlock({ type: "heading", text: "Change the disk size", cites: ["u2"] }), unitRevisionIds: ["r2"], isStale: false },
      { lineId: "l-step-00001", content: serializeDocBlock({ type: "steps", steps: [{ text: "Pick a size.", cites: ["u2"] }] }), unitRevisionIds: ["r2"], isStale: true },
    ] },
  ],
};

describe("reader model", () => {
  it("lists tasks and sub-tasks for On this page, without the intro", () => {
    const sections = readerSections(page);
    expect(pageHeadings(sections)).toEqual([
      { anchor: "task-bbbbbbbb", text: "Change a cluster", level: 2 },
      { anchor: "step-l-head-0", text: "Change the disk size", level: 3 },
    ]);
    expect(sections[1]!.blocks[1]).toMatchObject({ stale: true, block: { type: "steps" } });
  });

  it("groups the page tree by task, keeping set order", () => {
    const setUp = { ...page, id: "p0", title: "Creating a cluster", group: "set_up" as const };
    const loose = { ...page, id: "p9", title: "Overview", group: null };
    expect(pageTree([page, setUp, loose]).map((group) => [group.label, group.pages.map((item) => item.title)])).toEqual([
      [null, ["Overview"]], ["Set up", ["Creating a cluster"]], ["Change", ["Managing clusters"]],
    ]);
  });

  it("marks a page stale when a cited claim changed, and writing before its first build", () => {
    expect(isPageStale(page)).toBe(true);
    const fresh = { ...page, sections: page.sections.map((section) => ({ ...section, lines: section.lines.map((line) => ({ ...line, isStale: false })) })) };
    expect(isPageStale(fresh)).toBe(false);
    expect(isPageWriting(fresh)).toBe(false);
    const unwritten = { ...page, sections: [{ ...page.sections[1]!, status: "stale" as const, builtAt: null, lines: [] }] };
    expect(isPageWriting(unwritten)).toBe(true);
    expect(isPageStale(unwritten)).toBe(false);
  });

  it("stops treating an unbuilt page as writing once the set has finished (its first build failed)", () => {
    const unwritten = { ...page, sections: [{ ...page.sections[1]!, status: "stale" as const, builtAt: null, lines: [] }] };
    expect(isPageUnwritten(unwritten)).toBe(true);
    expect(isPageWriting(unwritten, false)).toBe(false);
    const building = { ...page, sections: [{ ...page.sections[1]!, status: "building" as const, builtAt: null, lines: [] }] };
    expect(isPageWriting(building, false)).toBe(true);
  });

  it("finds the claim behind each citation", () => {
    const claims = claimsByUnit({ claims: [{ revisionId: "r2", unitId: "u2", title: null, content: "Disks can grow." }] });
    expect(claims.get("u2")?.content).toBe("Disks can grow.");
  });

  it("exports what the reader shows", () => {
    const [, file] = docSetExportFiles({ title: "Clusters", pages: [page] });
    expect(file!.content).toBe("# Managing clusters\n\nA cluster is a group of hosts.\n\n## Change a cluster\n\n### Change the disk size\n\n1. Pick a size.\n");
  });
});
