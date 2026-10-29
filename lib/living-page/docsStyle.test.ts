import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { roleForPurpose } from "@/lib/ai/roles";
import { parseDocBlock } from "@/lib/docs/blocks";
import { getSectionWriter, rebuildSection, type SectionWriter } from "./index";
import { type DocsAnswer, type DocsAnswerBlock, type DocsModel, docsAnswerSchema, DocsSectionWriter, sectionAnswerSchema, sectionStyle, withDocsStyle } from "./docsStyle";
import type { SectionState } from "./types";

const chat = vi.hoisted(() => ({ calls: [] as { name: string }[] }));
vi.mock("@/lib/ai/chat", async (original) => ({
  ...(await original<typeof import("@/lib/ai/chat")>()),
  chatJson: vi.fn(async (_settings: unknown, request: { name: string }) => {
    chat.calls.push({ name: request.name });
    return { value: { revise: [], retire: [], add: [] }, model: "mock", tokensIn: 1, tokensOut: 1 };
  }),
}));

const empty = { text: "", cites: [], tone: "none", language: "", code: "", steps: [], items: [], params: [], tabs: [] } as const;
const block = (fields: Partial<DocsAnswerBlock> & Pick<DocsAnswerBlock, "type">): DocsAnswerBlock => ({ ...empty, steps: [], items: [], params: [], tabs: [], cites: [], ...fields });
type Inner = DocsAnswerBlock["tabs"][number]["blocks"][number];
const inner = (fields: Partial<Inner> & Pick<Inner, "type">): Inner => ({ ...empty, steps: [], items: [], params: [], cites: [], ...fields });

const units = [
  { unitId: "console", revisionId: "r-console", content: "Clusters are created on the Clusters page with the Create cluster button.", kind: "procedure" as const, epistemicStatus: "established" as const },
  { unitId: "cli", revisionId: "r-cli", content: "The CLI creates a cluster with: tool cluster create --name NAME.", kind: "procedure" as const, epistemicStatus: "established" as const },
  { unitId: "backup", revisionId: "r-backup", content: "Deleting a cluster deletes its backups.", kind: "fact" as const, epistemicStatus: "established" as const },
];
const docState: SectionState = { sectionId: "s", title: "Create a cluster", pageTitle: "Managing clusters", units, lines: [], query: { unitIds: units.map((unit) => unit.unitId), style: "doc", docPart: "task" } };

// A database that answers the living-page calls and records what is saved
function fakeDb(state: SectionState) {
  const saved: { actions: { type: string; input: { content?: string; unitRevisionIds?: string[] } }[] }[] = [];
  const call = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "claim_section_build") return { claimed: true };
    if (fn === "read_section_state") return state;
    if (fn === "read_page_context") return [];
    if (fn === "read_section_article_structure") return null;
    if (fn === "submit_change_set") { saved.push({ actions: args.p_actions as never }); return { changeSetId: `cs${saved.length}` }; }
    if (fn === "commit_change_set") return { status: "applied", applied: saved.at(-1)?.actions.length ?? 0, rejected: 0, exceptions: 0 };
    if (fn === "finish_section_build") return { sectionId: state.sectionId, changeNoteId: null };
    return {};
  });
  return { db: { call: call as DbRpc["call"] }, call, saved };
}

describe("docs section style", () => {
  it("reads the style from the section query", () => {
    expect(sectionStyle(docState)).toEqual({ kind: "doc", intro: false });
    expect(sectionStyle({ query: { style: "doc", docPart: "intro" } })).toEqual({ kind: "doc", intro: true });
    expect(sectionStyle({ query: { unitIds: ["a"] } })).toBeNull();
  });

  it("sends doc pages through the Docs writer role", () => {
    expect(roleForPurpose("docs_page")).toBe("docs_writer");
    expect(roleForPurpose("docs_outline")).toBe("docs_writer");
  });

  it("writes a doc section through the living page: tabs, code, params and callouts, each cited", async () => {
    const answer: DocsAnswer = { revise: [], retire: [], add: [
      block({ type: "tabs", tabs: [
        { label: "Web console", blocks: [inner({ type: "steps", steps: [{ text: "Open the Clusters page and click Create cluster.", cites: ["console"], substeps: [] }] })] },
        { label: "CLI", blocks: [
          inner({ type: "code", language: "bash", code: "tool cluster create --name <cluster_name>", cites: ["cli"] }),
          inner({ type: "params", params: [{ name: "cluster_name", description: "The cluster's name.", cites: ["cli"] }] }),
        ] },
      ] }),
      block({ type: "callout", tone: "warning", text: "Deleting a cluster also deletes its backups.", cites: ["backup"] }),
    ] };
    const model: DocsModel = vi.fn(async () => ({ value: answer, model: "mock-docs", tokensIn: 10, tokensOut: 20 }));
    const article: SectionWriter = { name: "article", reviseSection: vi.fn() };
    const writer = withDocsStyle(article, new DocsSectionWriter(model));
    const { db, saved } = fakeDb(docState);

    await rebuildSection(db, writer, "s", null);

    expect(article.reviseSection).not.toHaveBeenCalled();
    expect(model).toHaveBeenCalledOnce();
    const request = vi.mocked(model).mock.calls[0]![0];
    expect(request.system).toContain("Docs writer");
    expect(JSON.parse(request.user)).toMatchObject({ page: "Managing clusters", section: "Create a cluster", uncoveredUnitIds: ["console", "cli", "backup"] });
    const lines = saved.flatMap((set) => set.actions).filter((action) => action.type === "write_line");
    expect(lines).toHaveLength(2);
    expect(parseDocBlock(lines[0]!.input.content!)).toMatchObject({ type: "tabs", tabs: [{ label: "Web console" }, { label: "CLI" }] });
    expect(lines[0]!.input.unitRevisionIds).toEqual(["r-console", "r-cli"]);
    expect(parseDocBlock(lines[1]!.input.content!)).toEqual({ type: "callout", tone: "warning", text: "Deleting a cluster also deletes its backups.", cites: ["backup"] });
    expect(lines[1]!.input.unitRevisionIds).toEqual(["r-backup"]);
  });

  it("drops tabs the sources do not support and leaves uncited claims out", async () => {
    const answer: DocsAnswer = { revise: [], retire: [], add: [block({ type: "tabs", tabs: [
      { label: "Web console", blocks: [inner({ type: "steps", steps: [{ text: "Click Create cluster.", cites: ["console"], substeps: [] }] })] },
      { label: "API", blocks: [inner({ type: "code", language: "bash", code: "curl -X POST <endpoint>", cites: [] })] },
    ] })] };
    const writer = new DocsSectionWriter(async () => ({ value: answer, model: "mock", tokensIn: null, tokensOut: null }));
    const revision = await writer.reviseSection({ pageTitle: "P", sectionTitle: "Create", units, lines: [], uncoveredUnitIds: ["console", "cli", "backup"], style: { kind: "doc", intro: false } });
    expect(revision.add.map((line) => parseDocBlock(line.text).type)).toEqual(["steps"]);
    expect(revision.omittedUnitIds).toEqual(["cli", "backup"]);
  });

  it("asks the model for the same fields the answer is parsed with, intro and task alike", () => {
    const fields = (schema: { shape: { add: { element: { shape: object } } } }) => Object.keys(schema.shape.add.element.shape).sort();
    expect(fields(sectionAnswerSchema(true))).toEqual(fields(docsAnswerSchema));
    expect(fields(sectionAnswerSchema(false))).toEqual(fields(docsAnswerSchema));
    const intro = { revise: [], retire: [], add: [block({ type: "text", text: "A cluster is a database.", cites: ["console"] })] };
    expect(sectionAnswerSchema(true).safeParse(intro).success && docsAnswerSchema.safeParse(intro).success).toBe(true);
    expect(sectionAnswerSchema(false).safeParse(intro).success).toBe(false);
  });

  it("asks again when a task comes back without steps, and keeps the second answer", async () => {
    const headingOnly: DocsAnswer = { revise: [], retire: [], add: [block({ type: "heading", text: "Create a cluster", cites: ["console"] })] };
    const withSteps: DocsAnswer = { revise: [], retire: [], add: [block({ type: "steps", steps: [{ text: "Click Create cluster.", cites: ["console"], substeps: [] }] })] };
    const model = vi.fn<DocsModel>()
      .mockResolvedValueOnce({ value: headingOnly, model: "mock", tokensIn: null, tokensOut: null })
      .mockResolvedValueOnce({ value: withSteps, model: "mock", tokensIn: null, tokensOut: null });
    const revision = await new DocsSectionWriter(model).reviseSection({ pageTitle: "P", sectionTitle: "Create", units, lines: [], uncoveredUnitIds: ["console"], style: { kind: "doc", intro: false } });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1]![0].user).toContain("no steps block");
    expect(revision.add.map((line) => parseDocBlock(line.text).type)).toEqual(["steps"]);
  });

  it("falls back to one cited step per claim when the retry still has no steps", async () => {
    const empty: DocsAnswer = { revise: [], retire: [], add: [] };
    const model = vi.fn<DocsModel>().mockResolvedValue({ value: empty, model: "mock", tokensIn: null, tokensOut: null });
    const revision = await new DocsSectionWriter(model).reviseSection({ pageTitle: "P", sectionTitle: "Create", units, lines: [], uncoveredUnitIds: ["console", "cli"], style: { kind: "doc", intro: false } });
    expect(model).toHaveBeenCalledTimes(2);
    expect(parseDocBlock(revision.add[0]!.text)).toMatchObject({ type: "steps" });
    expect(revision.add[0]!.unitIds).toEqual(["console", "cli"]);
  });

  it("never asks again for the intro", async () => {
    const model = vi.fn<DocsModel>().mockResolvedValue({ value: { revise: [], retire: [], add: [block({ type: "text", text: "A cluster is a database.", cites: ["console"] })] }, model: "mock", tokensIn: null, tokensOut: null });
    await new DocsSectionWriter(model).reviseSection({ pageTitle: "P", sectionTitle: "Intro", units, lines: [], uncoveredUnitIds: ["console"], style: { kind: "doc", intro: true } });
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0]![0].intro).toBe(true);
  });

  it("rewrites only the stale line when a cited claim changes", async () => {
    const lines = [
      { lineId: "l1", lineRevisionId: "lr1", position: 0, content: JSON.stringify({ type: "steps", steps: [{ text: "Old step.", cites: ["console"] }] }), author: "ai" as const, unitIds: ["console"], needsRewrite: true },
      { lineId: "l2", lineRevisionId: "lr2", position: 1, content: JSON.stringify({ type: "callout", tone: "tip", text: "Kept.", cites: ["backup"] }), author: "ai" as const, unitIds: ["backup"], needsRewrite: false },
    ];
    const answer: DocsAnswer = { revise: [
      { lineId: "l1", blocks: [block({ type: "steps", steps: [{ text: "Click Create cluster on the Clusters page.", cites: ["console"], substeps: [] }] })] },
      { lineId: "l2", blocks: [block({ type: "text", text: "Not flagged: ignored.", cites: ["backup"] })] },
    ], retire: [], add: [] };
    const { db, saved } = fakeDb({ ...docState, units: [units[0]!, units[2]!], lines });
    await rebuildSection(db, withDocsStyle({ name: "a", reviseSection: vi.fn() }, new DocsSectionWriter(async () => ({ value: answer, model: "m", tokensIn: null, tokensOut: null }))), "s", null);
    const actions = saved.flatMap((set) => set.actions);
    expect(actions.map((action) => action.type)).toEqual(["revise_line"]);
    expect(parseDocBlock(actions[0]!.input.content!)).toMatchObject({ steps: [{ text: "Click Create cluster on the Clusters page." }] });
  });

  it("drops a block that states a number no cited claim gives", async () => {
    const answer: DocsAnswer = { revise: [], retire: [], add: [
      block({ type: "steps", steps: [{ text: "Wait 15 minutes, then click Create cluster.", cites: ["console"], substeps: [] }] }),
      block({ type: "callout", tone: "warning", text: "Deleting a cluster deletes its backups.", cites: ["backup"] }),
    ] };
    const { db, saved } = fakeDb({ ...docState, units: [units[0]!, units[2]!], query: { ...docState.query, unitIds: ["console", "backup"] } });
    await expect(rebuildSection(db, withDocsStyle({ name: "a", reviseSection: vi.fn() }, new DocsSectionWriter(async () => ({ value: answer, model: "m", tokensIn: null, tokensOut: null }))), "s", null))
      .rejects.toThrow("omitted saved knowledge");
    expect(saved).toEqual([]);
  });

  it("keeps article sections on the article writer and out of nothing else", async () => {
    const article: SectionWriter = { name: "article", reviseSection: vi.fn(async () => ({ revise: [], retire: [], add: [{ text: "Prose.", unitIds: ["backup"] }], modelVersion: "a" })) };
    const docs: SectionWriter = { name: "docs", reviseSection: vi.fn() };
    const { db } = fakeDb({ ...docState, units: [units[2]!], query: { unitIds: ["backup"] } });
    await rebuildSection(db, withDocsStyle(article, docs), "s", null);
    expect(article.reviseSection).toHaveBeenCalledOnce();
    expect(docs.reviseSection).not.toHaveBeenCalled();
  });

  it("skips the article editorial review for doc sections", async () => {
    const writer = withDocsStyle({ name: "article", reviseSection: vi.fn() }, new DocsSectionWriter(null));
    const review = vi.fn(async () => {});
    writer.reviewSections = review;
    await writer.prepareSection!({ ...docState, sectionId: "doc" });
    await writer.prepareSection!({ ...docState, sectionId: "prose", query: { unitIds: [] } });
    await writer.reviewSections!(["doc", "prose"]);
    expect(review).toHaveBeenCalledExactlyOnceWith(["prose"]);
    review.mockClear();
    await writer.reviewSections!(["doc"]);
    expect(review).not.toHaveBeenCalled();
  });

  it("writes deterministic blocks without a model: an intro paragraph and one step per claim", async () => {
    const writer = new DocsSectionWriter(null);
    const intro = await writer.reviseSection({ pageTitle: "P", sectionTitle: "Intro", units: [units[2]!], lines: [], uncoveredUnitIds: ["backup"], style: { kind: "doc", intro: true } });
    expect(parseDocBlock(intro.add[0]!.text)).toEqual({ type: "text", text: units[2]!.content, cites: ["backup"] });
    const task = await writer.reviseSection({ pageTitle: "P", sectionTitle: "Create", units: units.slice(0, 2), lines: [], uncoveredUnitIds: ["console", "cli"], style: { kind: "doc", intro: false } });
    expect(parseDocBlock(task.add[0]!.text)).toMatchObject({ type: "steps", steps: [{ cites: ["console"] }, { cites: ["cli"] }] });
  });

  it("calls the model as docs_page when AI is configured", async () => {
    const writer = getSectionWriter({ NEBIUS_API_KEY: "test" } as unknown as NodeJS.ProcessEnv);
    expect(writer.name).toBe("token-factory");
    await writer.reviseSection({ pageTitle: "P", sectionTitle: "Create", units: [units[0]!], lines: [], uncoveredUnitIds: ["console"], style: { kind: "doc", intro: false } });
    // the mocked answer has no steps, so the task is asked for once more
    expect(chat.calls).toEqual([{ name: "docs_page" }, { name: "docs_page" }]);
  });
});
