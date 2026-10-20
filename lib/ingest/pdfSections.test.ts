import { describe, expect, it } from "vitest";
import { bookSectionPaths, type PdfOutlineSource } from "./pdfSections";

function outline(nodes: Awaited<ReturnType<PdfOutlineSource["getOutline"]>>): PdfOutlineSource {
  return {
    async getOutline() { return nodes; },
    async getDestination(name) { return name === "ch6" ? [{ num: 3 }] : null; },
    async getPageIndex(ref) { return (ref as { num: number }).num - 1; },
  };
}

describe("bookSectionPaths", () => {
  const pages = ["front", "Assessment", "CHAPTER 6\nMisidentifications\n\nWhenever we teach people about the Enneagram.", "still in the chapter"];

  it("keeps each bookmark in force and reads a chapter title from the chapter's first page", async () => {
    const paths = await bookSectionPaths(outline([{
      title: "Assessment",
      dest: [{ num: 2 }],
      items: [{ title: "CHAPTER 6", dest: "ch6", items: [] }],
    }]), pages);
    expect(paths).toEqual([
      undefined,
      ["Assessment"],
      ["Assessment", "CHAPTER 6", "Misidentifications"],
      ["Assessment", "CHAPTER 6", "Misidentifications"],
    ]);
  });

  it("does not treat a long sentence under the chapter label as its title", async () => {
    const text = ["CHAPTER 6 This title is far too long to be a heading because it is a sentence that keeps going past the limit."];
    const paths = await bookSectionPaths(outline([{ title: "CHAPTER 6", dest: [{ num: 1 }], items: [] }]), text);
    expect(paths[0]).toEqual(["CHAPTER 6"]);
  });

  it("reads a chapter title printed on the same line as the chapter label", async () => {
    const text = ["CHAPTER 6: The Levels of Development\n\nA type changes over time."];
    const paths = await bookSectionPaths(outline([{ title: "CHAPTER 6", dest: [{ num: 1 }], items: [] }]), text);
    expect(paths[0]).toEqual(["CHAPTER 6", "The Levels of Development"]);
  });

  it("leaves pages unsectioned when the PDF has no outline", async () => {
    expect(await bookSectionPaths(outline(null), ["a", "b"])).toEqual([undefined, undefined]);
  });

  it("leaves pages unsectioned when the outline cannot be read", async () => {
    const pdf = outline(null);
    pdf.getOutline = async () => { throw new Error("broken outline"); };
    expect(await bookSectionPaths(pdf, ["a"])).toEqual([undefined]);
  });
});
