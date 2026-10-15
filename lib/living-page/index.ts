import type { AiCallLogger } from "@/lib/ai/callLog";
import type { StageSkills } from "@/lib/ai/skills/types";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { needsRewrite, revisionToActions, uncoveredUnitIds } from "./plan";
import type { FinishedSectionBuild, SectionRef, SectionReviseInput, SectionRevision, SectionState } from "./types";
import { FakeSectionWriter } from "./writers/fake";
import { TokenFactorySectionWriter } from "./writers/tokenFactory";

export type * from "./types";
export { commitLineEdit } from "./editLine";
export { needsRewrite, revisionToActions, uncoveredUnitIds } from "./plan";
export { MIN_CLAIMS_FOR_PAGE, type PageCandidate, pageProposalActions, proposePages } from "./proposePages";
export { FakeSectionWriter } from "./writers/fake";
export { TokenFactorySectionWriter } from "./writers/tokenFactory";

// =====================================================================
// LIVING PAGE: keeps page sections true after each commit. Lines are
// rows (supabase/migrations/20261015000000_lines_as_rows.sql). The
// database flags the lines whose claims changed and the claims no line
// states yet; the writer rewrites only those; its answer becomes line
// actions committed through Change control, like any other change.
// =====================================================================

// SECTION WRITER: rewrites flagged lines and writes lines for uncovered claims (fake or Nemotron)
export interface SectionWriter {
  readonly name: string;
  readonly promptVersion?: string;
  reviseSection(input: SectionReviseInput): Promise<SectionRevision>;
  prepareSection?(state: SectionState): Promise<SectionState>;
}

// Picks the writer from server env: Token Factory when NEBIUS_API_KEY is set, else the fake
export function getSectionWriter(env: NodeJS.ProcessEnv = process.env, chosenModel: string | null = null, skills?: StageSkills, logCall?: AiCallLogger): SectionWriter {
  const settings = tokenFactoryFromEnv(env, chosenModel, logCall);
  return settings ? new TokenFactorySectionWriter({ ...settings, skills }) : new FakeSectionWriter();
}

// =====================================================================
// REBUILDS
// =====================================================================

// Rebuilds every section the event touched (or that has stale lines), with a change note each
export async function rebuildAfterEvent(db: DbRpc, writer: SectionWriter, eventId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_affected_sections", { p_event_id: eventId });
  for (const section of sections) await rebuildSection(db, writer, section.sectionId, eventId);
}

// Builds every generated section of one page (used after a page is created); no change notes
export async function rebuildPage(db: DbRpc, writer: SectionWriter, pageId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  for (const section of sections) await rebuildSection(db, writer, section.sectionId, null);
}

// One section, in order: mark building, read its lines, rewrite what needs it, finish.
// A failure puts the section back to stale so the page never sits on "building".
export async function rebuildSection(
  db: DbRpc,
  writer: SectionWriter,
  sectionId: string,
  eventId: string | null,
): Promise<FinishedSectionBuild> {
  await db.call("mark_section_building", { p_section_id: sectionId });
  try {
    const loaded = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
    const state = writer.prepareSection ? await writer.prepareSection(loaded) : loaded;
    const written = needsRewrite(state) ? await rewriteLines(db, writer, state, eventId) : null;
    return await db.call<FinishedSectionBuild>("finish_section_build", {
      p_section_id: sectionId,
      p_event_id: eventId,
      p_model_version: written?.modelVersion ?? null,
      p_changed: (written?.applied ?? 0) > 0,
    });
  } catch (error) {
    await db.call("mark_section_stale", { p_section_id: sectionId });
    throw error;
  }
}

// Asks the writer, turns its answer into line actions and commits them as the AI.
// The set joins the causing event (or starts one for a new page's first build).
async function rewriteLines(
  db: DbRpc,
  writer: SectionWriter,
  state: SectionState,
  eventId: string | null,
): Promise<{ applied: number; modelVersion: string }> {
  const input = { pageTitle: state.pageTitle, sectionTitle: state.title, units: state.units, lines: state.lines, uncoveredUnitIds: uncoveredUnitIds(state) };
  const revision = await writer.reviseSection(input);
  const actions = revisionToActions(revision, state);
  if (actions.length === 0) return { applied: 0, modelVersion: revision.modelVersion };
  const draft = {
    summary: `Rewrote ${actions.length} line${actions.length === 1 ? "" : "s"} of "${state.title}"`,
    actions,
    trace: { modelVersion: revision.modelVersion, promptVersion: writer.promptVersion ?? null, tokensIn: null, tokensOut: null },
  };
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "edit", actor: "ai" }, draft);
  const result = await commitChangeSet(db, changeSetId);
  if (result.status !== "applied") throw new Error("The section update was not fully applied. Review its change set in Changes before retrying.");
  return { applied: result.applied, modelVersion: revision.modelVersion };
}
