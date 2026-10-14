import type { DraftAction, SectionDraft, UnitKind } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";

// =====================================================================
// PAGES FROM THE KNOWLEDGE: after an upload is committed, every entity
// its claims are about is checked. An entity with enough claims and no
// page gets one (named after the entity, one section per kind of claim);
// an entity page that lacks a section for a new kind gets that section.
// The proposals are typed actions in an AI ChangeSet, so Change control
// checks them, the Changes screen lists them and Undo removes them.
// =====================================================================

// An entity needs this many current claims before it earns its own page
export const MIN_CLAIMS_FOR_PAGE = 2;

// SECTION TITLE AND ORDER PER CLAIM KIND (decisions first: what was decided matters most)
const KIND_SECTIONS: { kind: UnitKind; title: string }[] = [
  { kind: "decision", title: "Decisions" },
  { kind: "fact", title: "Facts" },
  { kind: "procedure", title: "How it works" },
  { kind: "definition", title: "Definitions" },
  { kind: "preference", title: "Preferences" },
];

// DB: page_candidates (one per entity the event's claims are about)
export type PageCandidate = {
  entityId: string;
  type: string;
  key: string;
  name: string;
  claimCount: number;
  kinds: UnitKind[];
  page: { pageId: string; coveredKinds: UnitKind[]; coversAll: boolean } | null;
};

// Proposes and commits the pages and sections an event calls for; returns how many actions applied
export async function proposePages(db: DbRpc, eventId: string): Promise<number> {
  const candidates = await db.call<PageCandidate[]>("page_candidates", { p_event_id: eventId });
  const actions = pageProposalActions(candidates);
  if (actions.length === 0) return 0;
  const draft = {
    summary: describeProposals(actions),
    actions,
    trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null },
  };
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "upload", actor: "ai" }, draft);
  return (await commitChangeSet(db, changeSetId)).applied;
}

// PURE: the create_page / create_section actions for a list of candidates
export function pageProposalActions(candidates: PageCandidate[]): DraftAction[] {
  return candidates.flatMap((candidate) => {
    if (!candidate.page) {
      if (candidate.claimCount < MIN_CLAIMS_FOR_PAGE) return [];
      return [pageAction(candidate)];
    }
    const { page } = candidate;
    if (page.coversAll) return [];
    const missing = candidate.kinds.filter((kind) => !page.coveredKinds.includes(kind));
    return kindSections(candidate, missing).map((section) => sectionAction(page.pageId, section));
  });
}

// One section per kind, in KIND_SECTIONS order, each showing that entity's claims of that kind
function kindSections(candidate: PageCandidate, kinds: UnitKind[]): SectionDraft[] {
  const entity = { type: candidate.type, key: candidate.key };
  return KIND_SECTIONS.filter(({ kind }) => kinds.includes(kind)).map(({ kind, title }) => ({ title, query: { entity, kinds: [kind] } }));
}

// A new page for the entity, named after it
function pageAction(candidate: PageCandidate): DraftAction {
  const input = { title: candidate.name, entityId: candidate.entityId, sections: kindSections(candidate, candidate.kinds) };
  return { type: "create_page", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input };
}

// A new section on an existing page
function sectionAction(pageId: string, section: SectionDraft): DraftAction {
  return { type: "create_section", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { pageId, ...section } };
}

// "Proposed 2 pages and 1 section"
function describeProposals(actions: DraftAction[]): string {
  const pages = actions.filter((action) => action.type === "create_page").length;
  const sections = actions.length - pages;
  const parts = [pages ? `${pages} page${pages === 1 ? "" : "s"}` : null, sections ? `${sections} section${sections === 1 ? "" : "s"}` : null];
  return `Proposed ${parts.filter(Boolean).join(" and ")} from the new knowledge`;
}
