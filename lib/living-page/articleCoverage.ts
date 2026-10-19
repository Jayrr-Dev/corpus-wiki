import "server-only";
import { createHash } from "node:crypto";
import type { Embedder } from "@/lib/ai/embeddings";
import type { TokenFactorySettings } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { applyArticleScaffold } from "./articleScaffold";
import { discoverArticleUpdates } from "./discoverArticleUpdates";
import { rebuildUploadSection, type SectionWriter } from "./index";
import { needsRewrite } from "./plan";
import type { SectionRef, SectionState } from "./types";
import { workflowStep } from "@/lib/ingest/workflowContext";

export type CoverageDeps = { client: AdminSupabase; writer: SectionWriter };

// Runs once before editorial review. Builds without nested reviews, then the
// reviewer reads a fresh snapshot of the resulting article and its citations.
export async function expandArticleCoverage(db: DbRpc, settings: TokenFactorySettings, pageId: string, deps: CoverageDeps,
  embedder?: Embedder | null, progress?: (detail: string) => void, note = ""): Promise<void> {
  progress?.("Checking saved knowledge for missing article coverage…");
  const freshlyChecked = new Set<string>();
  // Parent overviews deliberately leave their children's details to child pages.
  const { data: children, error } = await deps.client.from("pages").select("id").eq("parent_page_id", pageId).is("retired_at", null).limit(1);
  if (error) throw new Error(error.message);
  if (!children?.length) {
    const noteKey = createHash("sha256").update(note).digest("hex");
    const result = await workflowStep(`article-coverage:${pageId}:discover-v2:${noteKey}`, () => discoverArticleUpdates(db, deps.client, settings, pageId, note, [], embedder));
    const built = await applyArticleScaffold(db, deps.client, settings, deps.writer, pageId, result.sections, note, progress);
    for (const id of built.sectionIds) freshlyChecked.add(id);
  }
  const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  for (const section of sections) {
    const state = await db.call<SectionState>("read_section_state", { p_section_id: section.sectionId });
    if (freshlyChecked.has(section.sectionId) && !state.lines.some(line => line.needsRewrite)) {
      // The scaffold just wrote and evidence-checked this exact section. A
      // valid editorial omission (covered elsewhere) is not another draft job.
      if (state.units.length && !state.lines.some(line => line.content.trim())) throw new Error(`“${state.title}” still has saved evidence but no text. Its writing needs to finish before the article can pass review.`);
      continue;
    }
    if (!needsRewrite(state)) continue;
    progress?.(`Writing missing coverage in ${state.title}…`);
    const built = await rebuildUploadSection(db, deps.writer, section.sectionId, null);
    if (!built || built.rebuildRequested) throw new Error("An article section is still being updated. Review it again when writing finishes.");
    const after = await db.call<SectionState>("read_section_state", { p_section_id: section.sectionId });
    if (after.units.length && !after.lines.some(line => line.content.trim())) throw new Error(`“${state.title}” still has saved evidence but no text. Its writing needs to finish before the article can pass review.`);
  }
}
