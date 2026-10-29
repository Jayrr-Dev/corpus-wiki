import { expect, it } from "vitest";
import { nextSuggestionToast, type SuggestionSnapshot } from "./suggestionToast";

function item(patch: Partial<SuggestionSnapshot> & Pick<SuggestionSnapshot, "id" | "kind" | "status">): SuggestionSnapshot {
  return { title: patch.id, note: null, writing: false, ...patch };
}

it("counts merges first and says it is safe to leave", () => {
  const items = [
    item({ id: "m1", kind: "merge", status: "accepting", title: "Enneagram", note: "Placing the claims on the existing sections…" }),
    item({ id: "c1", kind: "create", status: "accepting", title: "The Enneagram Institute" }),
  ];
  const first = nextSuggestionToast(items, new Set(), null, false);
  expect(first.toast).toMatchObject({
    title: "Applying suggestions",
    fraction: 0,
    done: false,
  });
  expect(first.toast?.detail).toBe("0 of 2 done.\nMerges go first.\nYou can leave this page.");

  const next = nextSuggestionToast(
    [item({ id: "m1", kind: "merge", status: "applied", title: "Enneagram" }), items[1]!],
    first.batch,
    null,
    false,
  );
  expect(next.toast?.detail).toBe("1 of 2 done.\nWriting a new article.\nYou can leave this page.");
  expect(next.toast?.fraction).toBe(0.5);
});

it("keeps the leave line when the AI key is missing", () => {
  const paused = nextSuggestionToast([
    item({ id: "m1", kind: "merge", status: "accepting", note: "openrouter/inception/mercury-3 is picked in Settings, but OPENROUTER_API_KEY is not set in the server env." }),
  ], new Set(), null, false);
  expect(paused.toast?.detail).toBe("Paused. The AI key is missing.\nYou can leave this page.");
  expect(paused.toast?.detail).not.toContain("OPENROUTER_API_KEY");
});

it("closes the toast once every tracked suggestion has settled", () => {
  const batch = new Set(["m1"]);
  const done = nextSuggestionToast([item({ id: "m1", kind: "merge", status: "applied" })], batch, null, false);
  expect(done.toast).toMatchObject({ done: true, fraction: 1, detail: "That suggestion is in." });
  expect(done.batch.size).toBe(0);
});

it("shows group progress while a run is still searching", () => {
  const run = nextSuggestionToast([], new Set(), { state: "running", phase: "suggesting", done: 3, total: 20, suggested: 0, error: null }, false);
  expect(run.watchingRun).toBe(true);
  expect(run.toast?.title).toBe("Finding suggestions");
  expect(run.toast?.detail).toContain("3 of 20 groups done.");
  expect(run.toast?.fraction).toBe(3 / 20);
});
