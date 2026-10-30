import { expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { CLAIM_TEXT_VERSION } from "./claimEmbeddingText";
import { embedMissingUnits } from "./embeddingStore";
it("saves independent chunks before another chunk fails and resumes only missing revisions", async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({ unit_id: String(index), revision_id: `r${index}`, content: String(index) }));
  const saved = new Set<string>();
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "stale_unit_embeddings") return rows.filter((row) => !saved.has(row.revision_id)) as T;
    const written = args.p_rows as { revisionId: string; embedding: number[] }[];
    written.forEach((row) => saved.add(row.revisionId));
    return written.length as T;
  } };
  const embed = vi.fn(async (texts: string[]) => {
    if (texts[0] === "0") throw new Error("Provider unavailable");
    return texts.map((text) => [Number(text) + 1]);
  });
  await expect(embedMissingUnits(db, { model: "test", embed })).rejects.toThrow("Provider unavailable");
  expect(saved.size).toBe(64);
  embed.mockClear().mockImplementation(async (texts) => texts.map((text) => [Number(text) + 1]));
  expect(await embedMissingUnits(db, { model: "test", embed })).toBe(66);
  expect(saved.size).toBe(130);
  expect(embed.mock.calls.flatMap(([texts]) => texts).some((text) => Number(text) >= 64 && Number(text) < 128)).toBe(false);
});

it("embeds stored claims with their context prefix and saves the text version", async () => {
  const written: { textVersion: number }[] = [];
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "stale_unit_embeddings") {
      expect(args.p_version).toBe(CLAIM_TEXT_VERSION);
      return (written.length ? [] : [
        { unit_id: "u1", revision_id: "r1", content: "Training is required annually", subjects: ["Acme Inc."], scope: ["Plant 2"], conditions: null },
        { unit_id: "u2", revision_id: "r2", content: "Water boils at 100 degrees", subjects: [], scope: [], conditions: null },
      ]) as T;
    }
    written.push(...(args.p_rows as { textVersion: number }[]));
    return (args.p_rows as unknown[]).length as T;
  } };
  const embed = vi.fn(async (texts: string[]) => texts.map(() => [1]));
  expect(await embedMissingUnits(db, { model: "test", embed })).toBe(2);
  expect(embed.mock.calls[0]![0]).toEqual(["Acme Inc. · Applies to: Plant 2 · Training is required annually", "Water boils at 100 degrees"]);
  expect(written.map((row) => row.textVersion)).toEqual([CLAIM_TEXT_VERSION, CLAIM_TEXT_VERSION]);
});
