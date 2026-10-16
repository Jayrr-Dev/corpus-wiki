import { describe, expect, it } from "vitest";
import { CompletionLengthError, ProviderTimeoutError } from "./chat";
import { splitOnCutOff } from "./splitOnCutOff";

describe("splitOnCutOff", () => {
  it("runs a batch that fits in one call", async () => {
    const calls: number[][] = [];
    await splitOnCutOff([1, 2, 3], async (part) => { calls.push(part); });
    expect(calls).toEqual([[1, 2, 3]]);
  });

  it("halves a cut-off batch until each part fits, keeping order", async () => {
    const done: number[][] = [];
    const splits: unknown[] = [];
    await splitOnCutOff([1, 2, 3, 4, 5], async (part) => {
      if (part.length > 2) throw new CompletionLengthError(10, 20, "m", 100);
      done.push(part);
    }, (error) => splits.push(error));
    expect(done).toEqual([[1, 2], [3], [4, 5]]);
    expect(splits).toHaveLength(2);
  });

  it("also splits on a provider timeout", async () => {
    const done: number[][] = [];
    await splitOnCutOff([1, 2], async (part) => {
      if (part.length > 1) throw new ProviderTimeoutError();
      done.push(part);
    });
    expect(done).toEqual([[1], [2]]);
  });

  it("throws when a single item still does not fit", async () => {
    await expect(splitOnCutOff([1, 2], async () => { throw new CompletionLengthError(1, 2, "m", 3); })).rejects.toBeInstanceOf(CompletionLengthError);
  });

  it("never retries other errors", async () => {
    let calls = 0;
    await expect(splitOnCutOff([1, 2], async () => { calls++; throw new Error("bad answer"); })).rejects.toThrow("bad answer");
    expect(calls).toBe(1);
  });
});
