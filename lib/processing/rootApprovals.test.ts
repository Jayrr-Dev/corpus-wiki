import { expect, it, vi } from "vitest";
import { applyRootApprovalBatches } from "./rootApprovals";

it("bounds work and continues the upload only after its last batch", async () => {
  const call = vi.fn().mockResolvedValueOnce({ eventId: "upload", complete: false, position: 24 })
    .mockResolvedValueOnce({ eventId: "upload", complete: true, position: 49 }).mockResolvedValue(null);
  const resume = vi.fn();
  await applyRootApprovalBatches({ call }, resume);
  expect(resume).toHaveBeenCalledExactlyOnceWith("upload");
  expect(call).toHaveBeenCalledTimes(3);
});

it("stops on saved backoff and bounds the number of batches per worker tick", async () => {
  const call = vi.fn().mockResolvedValue({ eventId: "upload", complete: false });
  const resume = vi.fn();
  await applyRootApprovalBatches({ call }, resume, 2);
  expect(call).toHaveBeenCalledTimes(2);
  expect(resume).not.toHaveBeenCalled();
  call.mockResolvedValueOnce({ error: "Temporary database failure" });
  await expect(applyRootApprovalBatches({ call }, resume)).rejects.toThrow("paused");
});
