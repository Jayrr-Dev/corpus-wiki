import { expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { FeatureFlagKey } from "./registry";
import { readFeatureFlags, saveFeatureFlag } from "./store";

function fakeDb(result: unknown) {
  const call = vi.fn(async () => result);
  return { db: { call } as unknown as DbRpc, call };
}

it("reads every flag, off when the database has no row", async () => {
  const { db, call } = fakeDb({ audio_ingest: true, retired_flag: true });
  expect(await readFeatureFlags(db)).toEqual({ billing: false, audio_ingest: true, chat_import: false, gmail_import: false, study: false, video: false, docs: false });
  expect(call).toHaveBeenCalledWith("get_feature_flags");
});

it("reads every flag off from an empty table", async () => {
  const { db } = fakeDb({});
  expect(Object.values(await readFeatureFlags(db)).every((on) => on === false)).toBe(true);
});

it("saves one flag through set_feature_flag", async () => {
  const { db, call } = fakeDb({ billing: true });
  expect((await saveFeatureFlag(db, "billing", true)).billing).toBe(true);
  expect(call).toHaveBeenCalledWith("set_feature_flag", { p_key: "billing", p_enabled: true });
});

it("refuses an unknown key or a value that is not a boolean", async () => {
  const { db, call } = fakeDb({});
  await expect(saveFeatureFlag(db, "nope" as FeatureFlagKey, true)).rejects.toThrow('Unknown feature flag "nope".');
  await expect(saveFeatureFlag(db, "billing", "true" as unknown as boolean)).rejects.toThrow("either on or off");
  expect(call).not.toHaveBeenCalled();
});
