import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { databaseBackoff, databaseUnavailable } from "./backoff";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  databaseBackoff.succeeded();
});
afterEach(() => vi.restoreAllMocks());

it("doubles the pause on each failure up to five minutes and clears it on success", () => {
  expect([1, 2, 3, 4, 5, 6].map(() => databaseBackoff.failed(0))).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000]);
  expect(databaseBackoff.paused(299_999)).toBe(true);
  expect(databaseBackoff.paused(300_000)).toBe(false);
  databaseBackoff.succeeded();
  expect(databaseBackoff.paused(0)).toBe(false);
  expect(databaseBackoff.failed(0)).toBe(15_000);
});

it("treats overload and gateway errors as the database struggling, not a job's own failure", () => {
  expect(databaseUnavailable(new Error("claim_suggestion_work: canceling statement due to statement timeout"))).toBe(true);
  expect(databaseUnavailable(new Error("worker_spaces: 521 Origin Down"))).toBe(true);
  expect(databaseUnavailable(new Error("claim_composer_job: Database request failed without error details"))).toBe(true);
  expect(databaseUnavailable(new Error("Model returned invalid JSON"))).toBe(false);
  expect(databaseUnavailable(new Error("finish_upload_step: duplicate key value violates unique constraint"))).toBe(false);
});
