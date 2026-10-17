import { expect, it } from "vitest";
import { latestUploads } from "./latestUploads";

it("shows only the latest run per source, preserving its unfinished status", () => {
  const original = { id: "original", source_id: "file", created_at: "2026-10-16T16:06:00Z", status: "applied" };
  const reruns = ["20:59", "21:08", "21:38"].map((time) => ({ id: time, source_id: "file", created_at: `2026-10-16T${time}:00Z`, status: "failed" }));
  const other = { id: "other", source_id: "another-file", created_at: "2026-10-16T22:00:00Z", status: "applied" };
  const deleted = { id: "deleted", source_id: null, created_at: "2026-10-17T00:00:00Z", status: "applied" };
  const events = [original, reruns[1]!, other, reruns[2]!, deleted, reruns[0]!];
  expect(latestUploads(events)).toEqual([other, reruns[2]]);
  expect(events).toHaveLength(6);
});
