import { it, expect, vi } from "vitest";
import { cleanAssetFiles } from "./cleanup";
import type { DbRpc } from "@/lib/db/rpc";

it("keeps failed storage deletions queued for retry and completes successful ones", async () => {
  const call = vi.fn().mockResolvedValueOnce([
    { id: "failed", bucket: "composer-images", path: "a.png" },
    { id: "success", bucket: "composer-images", path: "b.png" },
  ]).mockResolvedValue(undefined);
  const remove = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await cleanAssetFiles({ call } as DbRpc, remove);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("finish_asset_file_cleanup", { p_id: "success" });
    expect(call).not.toHaveBeenCalledWith("finish_asset_file_cleanup", { p_id: "failed" });
  } finally { warning.mockRestore(); }
});
