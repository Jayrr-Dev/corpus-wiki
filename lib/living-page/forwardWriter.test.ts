import { describe, expect, it, vi } from "vitest";
import type { SectionReviseInput, SectionRevision } from "./types";
import { forwardSectionWriter } from "./forwardWriter";
import type { SectionWriter } from "./index";

const INPUT = { pageTitle: "Page", sectionTitle: "Section", units: [], lines: [], uncoveredUnitIds: [] } as SectionReviseInput;
const REVISION = { modelVersion: "test", revise: [], retire: [], add: [] } satisfies SectionRevision;

class ClassWriter implements SectionWriter {
  readonly name = "class-writer";
  readonly seen: SectionReviseInput[] = [];
  async reviseSection(input: SectionReviseInput): Promise<SectionRevision> {
    this.seen.push(input);
    return REVISION;
  }
}

describe("forwardSectionWriter", () => {
  it("keeps reviseSection when the writer is a class", async () => {
    const writer = new ClassWriter();
    const forwarded = forwardSectionWriter(writer, { progress: () => ({ step() {}, thinking() {}, draft() {}, done() {} }) });
    await expect(forwarded.reviseSection(INPUT)).resolves.toBe(REVISION);
    expect(writer.seen).toEqual([INPUT]);
  });

  it("says to retry when the writer has no reviseSection", () => {
    expect(() => forwardSectionWriter({ name: "broken" } as SectionWriter)).toThrow("Retry this suggestion");
  });

  it("calls the patched reviseSection with the original writer still available", async () => {
    const reviseSection = vi.fn(async () => REVISION);
    const writer: SectionWriter = { name: "plain", reviseSection };
    const forwarded = forwardSectionWriter(writer, {
      reviseSection: (input) => writer.reviseSection({ ...input, updateNote: "accepted" }),
    });
    await forwarded.reviseSection(INPUT);
    expect(reviseSection).toHaveBeenCalledWith(expect.objectContaining({ updateNote: "accepted" }));
  });
});
