import { describe, expect, it } from "vitest";
import { type DocBlock, docBlockCites, docBlockText, hasTabs, isDocBlockContent, lineText, normalizeDocBlocks, parseDocBlock, placeholdersIn, serializeDocBlock } from "./blocks";

const steps: DocBlock = {
  type: "steps",
  steps: [
    { text: "Open the cluster page.", cites: ["a"] },
    { text: "Set the parameters:", cites: ["b"], substeps: [{ text: "Pick a preset.", cites: ["c"] }] },
  ],
};

describe("doc block lines", () => {
  it("round-trips every block type through a line's content", () => {
    const blocks: DocBlock[] = [
      { type: "text", text: "A cluster is a group of hosts.", cites: ["a"] },
      { type: "heading", text: "Change the disk size", cites: ["b"] },
      steps,
      { type: "prereqs", items: [{ text: "Install the CLI.", cites: ["d"] }] },
      { type: "code", language: "bash", code: "tool cluster create --name <cluster_name>", cites: ["e"] },
      { type: "params", params: [{ name: "cluster_name", description: "The new cluster's name.", cites: ["e"] }] },
      { type: "callout", tone: "warning", text: "Deleting a cluster removes its backups.", cites: ["f"] },
      { type: "tabs", tabs: [{ label: "Web console", blocks: [steps] }, { label: "CLI", blocks: [{ type: "code", language: "bash", code: "tool x", cites: ["e"] }] }] },
    ];
    for (const block of blocks) {
      const content = serializeDocBlock(block);
      expect(isDocBlockContent(content)).toBe(true);
      expect(parseDocBlock(content)).toEqual(block);
    }
  });

  it("reads a plain or broken line as a paragraph, never losing words", () => {
    expect(parseDocBlock("A person's plain edit.")).toEqual({ type: "text", text: "A person's plain edit.", cites: [] });
    expect(parseDocBlock('{"type":"steps","steps":"nope"}')).toEqual({ type: "text", text: '{"type":"steps","steps":"nope"}', cites: [] });
    expect(parseDocBlock('{"type": "steps"')).toMatchObject({ type: "text" });
  });

  it("collects citations from nested steps and tabs, once each", () => {
    expect(docBlockCites(steps)).toEqual(["a", "b", "c"]);
    expect(docBlockCites({ type: "tabs", tabs: [{ label: "A", blocks: [steps] }, { label: "B", blocks: [{ type: "text", text: "x", cites: ["a", "z"] }] }] })).toEqual(["a", "b", "c", "z"]);
  });

  it("gives the number check words, not ids", () => {
    const text = docBlockText({ type: "steps", steps: [{ text: "Wait 5 minutes.", cites: ["3f2a-41"], substeps: [{ text: "Check port 5432.", cites: [] }] }] });
    expect(text).toBe("Wait 5 minutes.\nCheck port 5432.");
  });

  it("finds placeholders in code", () => {
    expect(placeholdersIn("tool create --name <cluster_name> --size <disk.size> <cluster_name>")).toEqual(["cluster_name", "disk.size"]);
    expect(placeholdersIn("a < b and c>d")).toEqual([]);
  });
});

describe("normalizeDocBlocks", () => {
  it("keeps only claims the section shows and drops what cites none", () => {
    const blocks = normalizeDocBlocks([
      { type: "text", text: "Supported.", cites: ["a", "outside"] },
      { type: "text", text: "Invented.", cites: ["outside"] },
      { type: "steps", steps: [{ text: "Real step", cites: ["b"] }, { text: "Made-up step", cites: [] }] },
      { type: "params", params: [{ name: "<size>", description: "Disk size.", cites: ["c"] }, { name: "x", description: "y", cites: [] }] },
    ], ["a", "b", "c"]);
    expect(blocks).toEqual([
      { type: "text", text: "Supported.", cites: ["a"] },
      { type: "steps", steps: [{ text: "Real step", cites: ["b"] }] },
      { type: "params", params: [{ name: "size", description: "Disk size.", cites: ["c"] }] },
    ]);
  });

  it("keeps a step whose sub-steps are cited even when the step itself is not", () => {
    const [block] = normalizeDocBlocks([{ type: "steps", steps: [{ text: "Configure:", cites: [], substeps: [{ text: "Pick a preset.", cites: ["a"] }] }] }], ["a"]);
    expect(block).toEqual({ type: "steps", steps: [{ text: "Configure:", cites: [], substeps: [{ text: "Pick a preset.", cites: ["a"] }] }] });
  });

  it("shows tabs when the sources describe more than one way", () => {
    const blocks = normalizeDocBlocks([{ type: "tabs", tabs: [
      { label: "Web console", blocks: [{ type: "steps", steps: [{ text: "Click Create.", cites: ["console"] }] }] },
      { label: "CLI", blocks: [{ type: "code", language: "bash", code: "tool create", cites: ["cli"] }] },
    ] }], ["console", "cli"]);
    expect(hasTabs(blocks)).toBe(true);
    expect(blocks[0]).toMatchObject({ type: "tabs", tabs: [{ label: "Web console" }, { label: "CLI" }] });
  });

  it("unwraps tabs when only one way is supported by the sources", () => {
    const blocks = normalizeDocBlocks([{ type: "tabs", tabs: [
      { label: "Web console", blocks: [{ type: "steps", steps: [{ text: "Click Create.", cites: ["console"] }] }] },
      // no claim describes an API way: the tab cites nothing the section shows
      { label: "API", blocks: [{ type: "code", language: "bash", code: "curl -X POST <endpoint>", cites: ["invented"] }] },
    ] }], ["console"]);
    expect(hasTabs(blocks)).toBe(false);
    expect(blocks).toEqual([{ type: "steps", steps: [{ text: "Click Create.", cites: ["console"] }] }]);
  });

  it("unwraps a single tab and drops empty tab labels", () => {
    expect(hasTabs(normalizeDocBlocks([{ type: "tabs", tabs: [{ label: "CLI", blocks: [{ type: "text", text: "Run it.", cites: ["a"] }] }] }], ["a"]))).toBe(false);
    expect(hasTabs(normalizeDocBlocks([{ type: "tabs", tabs: [
      { label: " ", blocks: [{ type: "text", text: "One.", cites: ["a"] }] },
      { label: "CLI", blocks: [{ type: "text", text: "Two.", cites: ["b"] }] },
    ] }], ["a", "b"]))).toBe(false);
  });

  it("lets a sub-task heading cite the steps under it, and drops a heading with nothing under it", () => {
    const blocks = normalizeDocBlocks([
      { type: "heading", text: "Resize", cites: [] },
      { type: "steps", steps: [{ text: "Pick a size.", cites: ["a"] }] },
      { type: "heading", text: "Dangling", cites: [] },
    ], ["a"]);
    expect(blocks).toEqual([
      { type: "heading", text: "Resize", cites: ["a"] },
      { type: "steps", steps: [{ text: "Pick a size.", cites: ["a"] }] },
    ]);
  });
});

it("gives Composer a doc line's words and leaves article lines alone", () => {
  expect(lineText(serializeDocBlock({ type: "steps", steps: [{ text: "Ventilate the space.", cites: ["u1"] }, { text: "Test the air.", cites: ["u2"] }] }))).toBe("Ventilate the space.\nTest the air.");
  expect(lineText("A plain article sentence.")).toBe("A plain article sentence.");
});
