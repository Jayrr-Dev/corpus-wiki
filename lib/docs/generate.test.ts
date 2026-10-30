import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { DocsSectionWriter, withDocsStyle } from "@/lib/living-page";
import type { SectionState } from "@/lib/living-page/types";
import { parseDocBlock } from "./blocks";
import { type OutlineModel, proposeOutline, writeDocPages } from "./generate";

const claims = [
  { unitId: "a", title: "Clusters", content: "A cluster is a group of database hosts." },
  { unitId: "b", title: null, content: "Clusters are created on the Clusters page." },
  { unitId: "c", title: null, content: "Deleting a cluster deletes its backups." },
];

describe("proposeOutline", () => {
  it("asks the Docs writer for pages and keeps only what the scope holds", async () => {
    const model: OutlineModel = vi.fn(async () => ({ value: { title: "Clusters", pages: [
      { title: "Deleting a cluster", group: "remove" as const, introUnitIds: [], sections: [{ title: "Delete a cluster", unitIds: ["c"] }] },
      { title: "Creating a cluster", group: "set_up" as const, introUnitIds: ["a"], sections: [{ title: "Create a cluster", unitIds: ["b", "zzz"] }] },
    ] } }));
    const outline = await proposeOutline(model, "Topic › Clusters", claims);
    const request = vi.mocked(model).mock.calls[0]![0];
    expect(request.system).toContain("You are the Docs writer");
    expect(request.system).toContain("set_up");
    expect(request.system).toContain("at least 4 claims per page");
    expect(JSON.parse(request.user).claims).toHaveLength(3);
    // three claims over two pages is too thin: they become one page, each old page a task
    expect(outline.pages).toHaveLength(1);
    expect(outline.pages[0]).toMatchObject({ title: "Clusters", introUnitIds: ["a"], sections: [
      { title: "Creating a cluster", unitIds: ["b"] },
      { title: "Deleting a cluster", unitIds: ["c"] },
    ] });
  });

  it("builds a plain outline without AI, and when the model proposes nothing usable", async () => {
    expect((await proposeOutline(null, "Clusters", claims)).pages).toHaveLength(1);
    const empty: OutlineModel = async () => ({ value: { title: "", pages: [{ title: "X", group: "use", introUnitIds: ["nope"], sections: [] }] } });
    const outline = await proposeOutline(empty, "Clusters", claims);
    expect(outline.title).toBe("Clusters");
    expect(outline.pages[0]!.introUnitIds).toEqual(["a"]);
  });
});

describe("writeDocPages", () => {
  // One page with an intro and one task, built by the living page with the Docs style
  function fakeDb(failPage?: string) {
    const sections: Record<string, SectionState> = {
      intro: { sectionId: "intro", title: "Introduction", pageTitle: "Creating a cluster", units: [{ unitId: "a", revisionId: "ra", content: claims[0]!.content, kind: "definition", epistemicStatus: "established" }], lines: [], query: { unitIds: ["a"], style: "doc", docPart: "intro" } },
      task: { sectionId: "task", title: "Create a cluster", pageTitle: "Creating a cluster", units: [{ unitId: "b", revisionId: "rb", content: claims[1]!.content, kind: "procedure", epistemicStatus: "established" }], lines: [], query: { unitIds: ["b"], style: "doc", docPart: "task" } },
    };
    const written: { content: string; unitRevisionIds: string[] }[] = [];
    const call = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn === "list_page_sections") {
        if (args.p_page_id === failPage) throw new Error("Page is gone.");
        return [{ sectionId: "intro", pageId: "p1" }, { sectionId: "task", pageId: "p1" }];
      }
      if (fn === "claim_section_build") return { claimed: true };
      if (fn === "read_section_state") return sections[args.p_section_id as string];
      if (fn === "read_page_context" || fn === "read_section_article_structure") return null;
      if (fn === "submit_change_set") {
        for (const action of args.p_actions as { type: string; input: { content: string; unitRevisionIds: string[] } }[]) if (action.type === "write_line") written.push(action.input);
        return { changeSetId: "cs" };
      }
      if (fn === "commit_change_set") return { status: "applied", applied: 1, rejected: 0, exceptions: 0 };
      if (fn === "finish_section_build") return { sectionId: args.p_section_id, changeNoteId: null };
      return null;
    });
    return { db: { call: call as DbRpc["call"] }, call, written };
  }

  it("writes each page through the living page and marks the set ready", async () => {
    const { db, call, written } = fakeDb();
    const article = { name: "article", reviseSection: vi.fn() };
    const review = vi.fn(async () => {});
    const writer = withDocsStyle(article, new DocsSectionWriter(null));
    writer.reviewSections = review;
    await writeDocPages(db, writer, "set", ["p1"]);
    expect(article.reviseSection).not.toHaveBeenCalled();
    expect(written.map((line) => parseDocBlock(line.content).type)).toEqual(["text", "steps"]);
    expect(written.map((line) => line.unitRevisionIds)).toEqual([["ra"], ["rb"]]);
    expect(review).not.toHaveBeenCalled();
    const statuses = call.mock.calls.filter(([fn]) => fn === "set_doc_set_status").map(([, args]) => (args as { p_status: string }).p_status);
    expect(statuses).toEqual(["writing", "ready"]);
  });

  it("marks the set failed, with the reason, when a page cannot be written", async () => {
    const { db, call } = fakeDb("p2");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await writeDocPages(db, withDocsStyle({ name: "a", reviseSection: vi.fn() }, new DocsSectionWriter(null)), "set", ["p1", "p2"]);
    expect(call).toHaveBeenLastCalledWith("set_doc_set_status", { p_doc_set_id: "set", p_status: "failed", p_error: "1 page could not be written: Page is gone." });
  });
});
