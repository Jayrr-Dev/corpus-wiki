"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { composeLivePage, shownIllustrations } from "@/lib/composer/live";
import type { ComposerRun } from "@/lib/composer/types";
import { toActionResult } from "./result";

export async function illustrateArticle(pageId: string) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(pageId);
    return composeLivePage(supabaseRpc(getAdminSupabase()), pageId);
  });
}
export async function illustrateSection(sectionId: string, note: string) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(sectionId);
    const guidance = z.string().trim().max(2000).parse(note);
    const client = getAdminSupabase();
    const { data: section, error } = await client.from("sections").select("id,page_id,title").eq("id", sectionId).is("retired_at", null).single();
    if (error) throw new Error(error.message);
    const { data: lines, error: linesError } = await client.from("section_lines").select("line_id").eq("section_id", section.id);
    if (linesError) throw new Error(linesError.message);
    return composeLivePage(supabaseRpc(client), section.page_id, { targetParagraphIds: lines.flatMap((l) => l.line_id ? [l.line_id] : []),
      feedback: `The user explicitly requests a NEW illustration for the section ${JSON.stringify(section.title)}. Target only its allowed paragraph ids. Replace the existing illustration with a different one; do not return the same asset or identical SVG. This manual request overrides automatic candidate priority, not factual accuracy, source qualifications or the spatial illustration brief. Preserve other sections' figures. Optional user guidance: ${guidance || "Choose the most useful supported visual explanation and appropriate medium for this section."}` });
  });
}
export async function readArticleIllustrations(pageId: string) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(pageId);
    // Also initializes the worker in a warm development server after hot reload.
    const { startComposerWorker } = await import("@/lib/composer/worker");
    startComposerWorker();
    const run = await supabaseRpc(getAdminSupabase()).call<ComposerRun | null>("read_composer_run", { p_page_id: pageId });
    return { figures: shownIllustrations(run) };
  });
}
export async function removeArticleIllustrations(pageId: string) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(pageId);
    const db = supabaseRpc(getAdminSupabase());
    const previous = await db.call<ComposerRun | null>("read_composer_run", { p_page_id: pageId });
    await db.call("suppress_composer_page", { p_page_id: pageId });
    await db.call("select_composer_run", { p_page_id: pageId, p_run_id: null });
    return { previousRunId: previous?.id ?? null };
  });
}
export async function restoreArticleIllustrations(pageId: string, runId: string) {
  return toActionResult(async () => {
    await requireUser(); z.uuid().parse(pageId); z.uuid().parse(runId);
    await supabaseRpc(getAdminSupabase()).call("suppress_composer_page", { p_page_id: pageId });
    await supabaseRpc(getAdminSupabase()).call("select_composer_run", { p_page_id: pageId, p_run_id: runId });
    return {};
  });
}
