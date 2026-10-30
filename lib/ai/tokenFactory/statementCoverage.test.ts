import { describe, expect, it, vi } from "vitest";
import { missedStatements, statementCount, withEveryStatement } from "./statementCoverage";

const passages = [{ text: "A club opens at six each day. Members swipe a card here. Lap lanes are for adults. Kids stay near a parent. Short." }, { text: "Coach Mira sets the lanes.\nGuests are limited to two." }];
const answer = (claims: number) => ({ value: { claims: Array<unknown>(claims).fill({}) } });

describe("statement coverage", () => {
  it("counts sentences and lines, not short fragments", () => {
    expect(statementCount(passages)).toBe(6);
  });
  it("flags an answer with under half the statements, and leaves small or full batches alone", () => {
    expect(missedStatements(passages, 2)).toBe(6);
    expect(missedStatements(passages, 3)).toBe(0);
    expect(missedStatements([{ text: "One short fact is here." }], 0)).toBe(0);
  });
  it("asks once more and keeps the longer answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ask = vi.fn().mockResolvedValue(answer(6));
    expect((await withEveryStatement(answer(1), passages, ask)).value.claims).toHaveLength(6);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((await withEveryStatement(answer(1), passages, vi.fn().mockResolvedValue(answer(0)))).value.claims).toHaveLength(1);
    warn.mockRestore();
  });
  it("does not ask when the answer is fine", async () => {
    const ask = vi.fn();
    await withEveryStatement(answer(6), passages, ask);
    expect(ask).not.toHaveBeenCalled();
  });
});
