import { expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";

// Opt-in script context uses the configured service account. The app's normal
// signed-in guard and post-response scheduler need an HTTP request, so only
// those transport boundaries are substituted; reads, models and writes are real.
const transport = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: async () => {} }));
vi.mock("next/server", () => ({ after: transport.after }));

it.runIf(process.env.PROCESSING_LIVE_EMPTY_ARTICLE === "1")("updates the empty clearance article using the live app services", async () => {
  const { updateArticle } = await import("@/lib/server-actions/pages");
  const { getAdminSupabase } = await import("@/lib/supabase/admin");
  const client = getAdminSupabase();
  const pageId = "4ae929a5-86c8-4cf3-a587-a4d6c65fdd88";
  const started = performance.now();
  const result = await updateArticle({ scope: "page", id: pageId, note: "" });
  const [sections, lines] = await Promise.all([
    client.from("sections").select("id,title").eq("page_id", pageId).is("retired_at", null),
    client.from("section_lines").select("unit_revision_ids").eq("page_id", pageId),
  ]);
  if (sections.error) throw sections.error;
  if (lines.error) throw lines.error;
  const report = { result, durationMs: Math.round(performance.now() - started), pageId, sections: sections.data,
    lines: lines.data.length, citedLines: lines.data.filter((line) => line.unit_revision_ids?.length).length,
    deferredWebFills: transport.after.mock.calls.length };
  await mkdir("artifacts/processing", { recursive: true });
  await writeFile("artifacts/processing/empty-article-live.json", JSON.stringify(report, null, 2));
  expect(result.ok).toBe(true);
  if (result.ok && result.sections) expect(report.citedLines).toBeGreaterThan(0);
  else expect(result).toMatchObject({ sections: 0, message: expect.any(String) });
}, 10 * 60_000);
