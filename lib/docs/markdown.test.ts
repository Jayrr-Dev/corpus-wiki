import { describe, expect, it } from "vitest";
import { serializeDocBlock } from "./blocks";
import { docPageMarkdown, docSetMarkdownFiles, docSlug } from "./markdown";
import { crc32, zipFiles } from "./zip";

const page = {
  title: "Managing clusters",
  sections: [
    { title: "Intro", intro: true, lines: [serializeDocBlock({ type: "text", text: "A cluster is a group of database hosts.", cites: ["a"] })] },
    {
      title: "Create a cluster",
      lines: [
        serializeDocBlock({ type: "tabs", tabs: [
          { label: "Web console", blocks: [{ type: "steps", steps: [{ text: "Open Clusters.", cites: ["b"] }, { text: "Set:", cites: ["c"], substeps: [{ text: "The name.", cites: ["c"] }] }] }] },
          { label: "CLI", blocks: [
            { type: "prereqs", items: [{ text: "Install the CLI.", cites: ["d"] }] },
            { type: "code", language: "bash", code: "tool cluster create --name <cluster_name>", cites: ["d"] },
            { type: "params", params: [{ name: "cluster_name", description: "A unique name.", cites: ["d"] }] },
          ] },
        ] }),
        serializeDocBlock({ type: "callout", tone: "tip", text: "Use a short name.", cites: ["e"] }),
      ],
    },
    { title: "Delete a cluster", lines: [serializeDocBlock({ type: "callout", tone: "warning", text: "Backups are deleted too.", cites: ["f"] }), "A plain line a person wrote."] },
  ],
};

describe("Markdown export", () => {
  it("writes a page as H1, intro, tasks as H2, numbered steps, code and callouts", () => {
    expect(docPageMarkdown(page)).toBe(`# Managing clusters

A cluster is a group of database hosts.

## Create a cluster

**Web console**

1. Open Clusters.
2. Set:
   1. The name.

**CLI**

**Prerequisites**

- Install the CLI.

\`\`\`bash
tool cluster create --name <cluster_name>
\`\`\`

- \`cluster_name\`: A unique name.

> **Tip:** Use a short name.

## Delete a cluster

> **Warning:** Backups are deleted too.

A plain line a person wrote.
`);
  });

  it("uses a longer fence when the code holds backticks", () => {
    const markdown = docPageMarkdown({ title: "T", sections: [{ title: "S", lines: [serializeDocBlock({ type: "code", language: "", code: "echo ```", cites: ["a"] })] }] });
    expect(markdown).toContain("````\necho ```\n````");
  });

  it("names one file per page in order, with an index", () => {
    const files = docSetMarkdownFiles("Cluster docs", [page, { title: "Résumé & backups", sections: [] }]);
    expect(files.map((file) => file.name)).toEqual(["README.md", "01-managing-clusters.md", "02-resume-backups.md"]);
    expect(files[0]!.content).toBe("# Cluster docs\n\n1. [Managing clusters](01-managing-clusters.md)\n2. [Résumé & backups](02-resume-backups.md)\n");
    expect(docSlug("!!!")).toBe("page");
  });
});

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores each file with a central directory entry", () => {
    const zip = zipFiles([{ name: "README.md", content: "# Docs\n" }, { name: "01-a.md", content: "é" }]);
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralAt = view.getUint32(end + 16, true);
    expect(view.getUint32(centralAt, true)).toBe(0x02014b50);
    // first local file: header, name, then the bytes as stored
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const nameLength = view.getUint16(26, true);
    const size = view.getUint32(18, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLength))).toBe("README.md");
    expect(new TextDecoder().decode(zip.slice(30 + nameLength, 30 + nameLength + size))).toBe("# Docs\n");
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode("# Docs\n")));
  });
});
