import type { LineText, SectionReviseInput, SectionRevision } from "../types";

// MODEL VERSION RECORDED ON LINES THE FAKE WRITES
export const FAKE_WRITER_MODEL = "fake";

// =====================================================================
// FAKE WRITER: no network, deterministic. A line states its claims'
// current text verbatim, so tests can predict every line.
// =====================================================================

export class FakeSectionWriter {
  readonly name = "fake";

  // Flagged lines keep only the claims the section still shows (none left = retire);
  // each uncovered claim gets a line of its own
  async reviseSection(input: SectionReviseInput): Promise<SectionRevision> {
    const contentOf = new Map(input.units.map((unit) => [unit.unitId, unit.content]));
    const flagged = input.lines.filter((line) => line.needsRewrite);
    const kept = flagged.map((line) => ({ lineId: line.lineId, unitIds: line.unitIds.filter((id) => contentOf.has(id)) }));
    const revise = kept.filter((line) => line.unitIds.length > 0).map((line) => ({ ...line, text: joinClaims(line.unitIds, contentOf) }));
    const retire = kept.filter((line) => line.unitIds.length === 0).map((line) => line.lineId);
    const add: LineText[] = input.uncoveredUnitIds.map((unitId) => ({ text: joinClaims([unitId], contentOf), unitIds: [unitId] }));
    return { revise, retire, add, modelVersion: FAKE_WRITER_MODEL };
  }
}

// The claims' text, in the order given, as one line
function joinClaims(unitIds: string[], contentOf: ReadonlyMap<string, string>): string {
  return unitIds.map((id) => contentOf.get(id) ?? "").join(" ").trim();
}
