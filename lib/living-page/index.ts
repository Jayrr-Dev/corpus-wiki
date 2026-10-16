import { createHash } from "node:crypto";
import { assertActiveUpload, reportUploadProgress, uploadExecution } from "@/lib/ingest/workflowContext";
import type { AiCallLogger } from "@/lib/ai/callLog";
import type { StageSkills } from "@/lib/ai/skills/types";
import { type ModelChoice, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { commitAsRole, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import type { SectionProgress } from "./buildProgress";
import { needsRewrite, revisionToActions, uncoveredUnitIds } from "./plan";
import type { FinishedSectionBuild, PageContextSection, SectionRef, SectionReviseInput, SectionRevision, SectionState } from "./types";
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

// SECTION WRITER: rewrites flagged lines and writes lines for uncovered claims (fake or Nemotron).
// `progress` (set by the server deps) opens a reporter per section; the writer streams its draft to it.
export interface SectionWriter {
  readonly name: string;
  readonly promptVersion?: string;
  reviseSection(input: SectionReviseInput, progress?: SectionProgress): Promise<SectionRevision>;
  prepareSection?(state: SectionState): Promise<SectionState>;
  progress?: (sectionId: string) => SectionProgress;
  reviewSections?: (sectionIds: string[]) => Promise<void>;
}

// Picks the writer from server env: Token Factory when NEBIUS_API_KEY is set, else the fake
export function getSectionWriter(env: NodeJS.ProcessEnv = process.env, chosenModel: string | null | ModelChoice = null, skills?: StageSkills, logCall?: AiCallLogger): SectionWriter {
  const settings = tokenFactoryFromEnv(env, chosenModel, logCall);
  return settings ? new TokenFactorySectionWriter({ ...settings, skills }) : new FakeSectionWriter();
}

// =====================================================================
// REBUILDS
// =====================================================================

// Rebuilds every section the event touched (or that has stale lines), with a change note each
export async function rebuildAfterEvent(db: DbRpc, writer: SectionWriter, eventId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_affected_sections", { p_event_id: eventId });
  for (const [index, section] of sections.entries()) {
    await reportUploadProgress({ step: "pages", done: index, total: sections.length });
    const built = await rebuildSection(db, writer, section.sectionId, eventId, false);
    if (uploadExecution.getStore() && (!built || built.rebuildRequested)) throw new Error("A page section is still being updated. Resume after its current build finishes.");
  }
  if (sections.length) await writer.reviewSections?.(sections.map((section) => section.sectionId));
}

// Builds every generated section of one page (used after a page is created); no change notes
export async function rebuildPage(db: DbRpc, writer: SectionWriter, pageId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  for (const section of sections) await rebuildSection(db, writer, section.sectionId, null, false);
  if (sections.length) await writer.reviewSections?.(sections.map((section) => section.sectionId));
}

// One section, in order: claim it, read its lines, rewrite what needs it, finish.
// Only one build runs per section: a caller that finds it building leaves a request and
// returns null, and the running build goes again with the newest claims when it finishes.
// A failure puts the section back to stale so the page never sits on "building".
export async function rebuildSection(
  db: DbRpc,
  writer: SectionWriter,
  sectionId: string,
  eventId: string | null,
  review = true,
): Promise<FinishedSectionBuild | null> {
  let causeId = eventId;
  let finished: FinishedSectionBuild | null = null;
  for (let pass = 0; pass < 3; pass++) {
    await assertActiveUpload();
    const claim = await db.call<{ claimed: boolean }>("claim_section_build", { p_section_id: sectionId, p_event_id: causeId });
    if (!claim.claimed) return finished;
    finished = await buildClaimedSection(db, writer, sectionId, causeId);
    if (!finished.rebuildRequested) {
      if (review) await writer.reviewSections?.([sectionId]);
      return finished;
    }
    causeId = finished.rebuildEventId ?? null;
  }
  // Still asked for after three passes: stop here rather than loop; the next trigger claims it
  return finished;
}

async function buildClaimedSection(
  db: DbRpc,
  writer: SectionWriter,
  sectionId: string,
  eventId: string | null,
): Promise<FinishedSectionBuild> {
  const progress = writer.progress?.(sectionId);
  try {
    progress?.step("Reading the claims this section cites…");
    const loaded = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
    const state = writer.prepareSection ? await writer.prepareSection(loaded) : loaded;
    const written = needsRewrite(state) ? await rewriteLines(db, writer, state, eventId, progress) : null;
    progress?.step("Finishing up…");
    await assertActiveUpload();
    return await db.call<FinishedSectionBuild>("finish_section_build", {
      p_section_id: sectionId,
      p_event_id: eventId,
      p_model_version: written?.modelVersion ?? null,
      p_changed: (written?.applied ?? 0) > 0,
    });
  } catch (error) {
    await assertActiveUpload();
    await db.call("mark_section_stale", { p_section_id: sectionId });
    throw error;
  } finally {
    progress?.done();
  }
}

// Asks the writer, turns its answer into line actions and commits them as the AI.
// The set joins the causing event (or starts one for a new page's first build).
async function rewriteLines(
  db: DbRpc,
  writer: SectionWriter,
  state: SectionState,
  eventId: string | null,
  progress: SectionProgress | undefined,
): Promise<{ applied: number; modelVersion: string }> {
  const pageContext = await readPageContext(db, state.sectionId);
  const input = { pageTitle: state.pageTitle, sectionTitle: state.title, units: state.units, lines: state.lines, uncoveredUnitIds: uncoveredUnitIds(state), ...(pageContext.length ? { pageContext } : {}) };
  const flagged = state.lines.filter((line) => line.needsRewrite).length;
  progress?.step(writingStep(flagged, input.uncoveredUnitIds.length));
  const revision = progress ? await writer.reviseSection(input, progress) : await writer.reviseSection(input);
  const actions = revisionToActions(revision, state, ({ text, numbers }) =>
    console.warn("Writer line dropped for unsupported numbers", { sectionId: state.sectionId, page: state.pageTitle, section: state.title, numbers, text: text.slice(0, 160) }));
  if (actions.length === 0) return { applied: 0, modelVersion: revision.modelVersion };
  progress?.step(`Saving ${actions.length} change${actions.length === 1 ? "" : "s"}…`);
  const draft = {
    summary: `Rewrote ${actions.length} line${actions.length === 1 ? "" : "s"} of "${state.title}"`,
    actions,
    trace: { modelVersion: revision.modelVersion, promptVersion: writer.promptVersion ?? null, tokensIn: revision.tokensIn ?? null, tokensOut: revision.tokensOut ?? null },
  };
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "edit", actor: "ai", operationKey: `section:${state.sectionId}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}` }, draft);
  const result = await commitAsRole(db, "write_articles", changeSetId);
  // Held changes (a person's line the AI wants to change) wait on Exceptions; only a refused change is a failure
  if (result.status === "rejected" || result.rejected > 0) throw new Error("The section update was not fully applied. Review its change set in Changes before retrying.");
  return { applied: result.applied, modelVersion: revision.modelVersion };
}

// What the page's other sections say, for the writer; a database without read_page_context gives none
async function readPageContext(db: DbRpc, sectionId: string): Promise<PageContextSection[]> {
  try {
    const sections = await db.call<PageContextSection[]>("read_page_context", { p_section_id: sectionId });
    return Array.isArray(sections) ? sections : [];
  } catch (error) {
    console.warn("Section written without the rest of its page", { sectionId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

// "Rewriting 2 paragraphs and covering 3 new claims…", for the step shown on the page
function writingStep(flagged: number, uncovered: number): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts = [flagged ? `rewriting ${plural(flagged, "paragraph")}` : "", uncovered ? `covering ${plural(uncovered, "new claim")}` : ""].filter(Boolean);
  const text = parts.join(" and ") || "writing";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}…`;
}
