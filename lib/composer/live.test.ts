import { expect, it, vi } from "vitest";
import { composeNextAutomatic } from "./live";
import type { ComposerClaim } from "./jobs";
import type { ComposerRun } from "./types";

it("keeps an existing run through repeated automatic updates without generating replacement images", async () => {
  const run = { id: "original-run", composition: { figures: [{ svg: "original-drawing" }] } } as ComposerRun;
  const claim: ComposerClaim = { pageId: "page", token: "token", snapshot: { title: "Article", slug: "article", paragraphs: [{ id: "new-line", revisionId: "new-revision", section: "New section", text: "Updated text", hasMedia: false }] } };
  const call = vi.fn(async (name: string) => {
    if (name === "claim_composer_job") return claim;
    if (name === "read_composer_run") return run;
    if (name === "finish_composer_job") return null;
    throw new Error(`Unexpected generation or mutation: ${name}`);
  });
  for (let i = 0; i < 3; i++) expect(await composeNextAutomatic({ call: call as never })).toBe(true);
  expect(call.mock.calls.filter(([name]) => name === "read_composer_run")).toHaveLength(3);
  expect(call.mock.calls.filter(([name]) => name === "finish_composer_job")).toHaveLength(3);
});
