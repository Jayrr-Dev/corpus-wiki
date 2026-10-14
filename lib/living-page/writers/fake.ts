import type { SectionWriteInput, WrittenSection } from "../types";

// MODEL VERSION RECORDED ON SECTIONS THE FAKE BUILDS
export const FAKE_WRITER_MODEL = "fake";

// FAKE WRITER: no network, deterministic. One sentence per unit, in the order given
// (the DB orders units by valid_from, created_at), so sentence_links map 1:1 to units.
export class FakeSectionWriter {
  readonly name = "fake";

  // Each unit's content becomes one sentence citing only that unit
  async writeSection(input: SectionWriteInput): Promise<WrittenSection> {
    const sentences = input.units.map((unit) => ({ text: unit.content, unitIds: [unit.unitId] }));
    return { sentences, modelVersion: FAKE_WRITER_MODEL };
  }
}
