import { describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_OPTIONS, toUploadOptions } from "./uploadOptions";

describe("toUploadOptions", () => {
  it("reads missing or unknown values as off", () => {
    expect(toUploadOptions(null)).toEqual(DEFAULT_UPLOAD_OPTIONS);
    expect(toUploadOptions({ autoApprove: "yes", other: true })).toEqual(DEFAULT_UPLOAD_OPTIONS);
  });

  it("keeps the switches that are on", () => {
    expect(toUploadOptions({ autoApprove: true, skipReviews: true })).toEqual({ autoApprove: true });
  });
});
