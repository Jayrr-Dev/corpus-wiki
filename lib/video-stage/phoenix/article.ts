import type { QueryClient } from "@tanstack/react-query";
import type { Tables } from "@/lib/database/types";
import { buildArticleEvidence, type ArticleEvidence } from "@/lib/living-page/articleEvidence";
import { queryKeys } from "@/lib/queries/keys";
import type { ShownLine } from "@/lib/queries/sectionLines";
import type { StakeholderCard } from "@/lib/stakeholders/cards";
import { fakeDate, fakeHash, fakeId, PEOPLE, PHOENIX_ACCOUNT, SOURCES, type PersonKey, type PhoenixSource } from "./core";

// =====================================================================
// PHOENIX ARTICLES: the wiki pages the page-lane scenes draw with the
// real living-page components. The "Phoenix release runbook" (whose
// deploy-window line a newer CAB file rewrites) and "Brent's handover".
// Each line cites one claim; the claim's passages point into SOURCES.
// Plain data plus the row builders and cache seeds the scenes need.
// =====================================================================

const MODEL = "nvidia/Llama-3.3-Nemotron-Super-49B-v1.5";

// THE NEWER FILE: April's CAB minutes move the deploy window
export const CAB_APRIL: PhoenixSource = {
  key: "cabMinutesApril",
  id: fakeId("source", "cabMinutesApril"),
  kind: "docx",
  title: "CAB-Minutes-2026-04.docx",
  date: "2026-04-14",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  origin: "internal",
  author: "patty",
};

type Cite = { source: PhoenixSource; quote: string; page?: number };

export type ArticleLine = {
  key: string;
  section: string;
  text: string;
  // the claim the line states, in the claim card's words
  claim: string;
  cites: Cite[];
  // when the line was first written (YYYY-MM-DD)
  written: string;
};

export type ArticleSection = { key: string; title: string };

export type Article = { key: string; id: string; title: string; sections: ArticleSection[]; lines: ArticleLine[] };

// THE RUNBOOK: four sections, seven cited lines
export const RUNBOOK: Article = {
  key: "runbook",
  id: fakeId("page", "runbook"),
  title: "Phoenix release runbook",
  sections: [
    { key: "overview", title: "Overview" },
    { key: "deploy", title: "Deploy window" },
    { key: "rollback", title: "Rollback" },
    { key: "who", title: "Who to ask" },
  ],
  lines: [
    {
      key: "overview", section: "overview", written: "2026-04-02",
      text: "Phoenix moves retail checkout from PayCore to Ledgerly. Bill Palmer owns the release since Brent Geller left on 3 April 2026.",
      claim: "Bill Palmer owns the Phoenix release after Brent Geller's last day, 3 April 2026.",
      cites: [
        { source: SOURCES.runbook, quote: "Phoenix replaces PayCore with Ledgerly for every retail checkout.", page: 1 },
        { source: SOURCES.handover, quote: "From Monday Bill owns the release; everything I know about it is in here." },
      ],
    },
    {
      key: "deploy-window", section: "deploy", written: "2026-03-10",
      text: "Production deploys run on Saturdays from 22:00 to 02:00, once the change advisory board signs off on Thursday.",
      claim: "Phoenix production deploys run Saturdays 22:00 to 02:00, after CAB sign-off on Thursday.",
      cites: [{ source: SOURCES.cabMinutes, quote: "Agreed: Phoenix deploys Saturday 22:00 to 02:00. CAB signs off each Thursday.", page: 2 }],
    },
    {
      key: "freeze", section: "deploy", written: "2026-03-02",
      text: "Every other change to the payment path is frozen for 24 hours before a deploy.",
      claim: "Other payment-path changes freeze for 24 hours before a Phoenix deploy.",
      cites: [{ source: SOURCES.runbook, quote: "No other change may touch the payment path in the 24 hours before a deploy.", page: 4 }],
    },
    {
      key: "rollback", section: "rollback", written: "2026-03-24",
      text: "To roll back, switch the checkout flag back to PayCore. It takes about 6 minutes and needs no database restore.",
      claim: "Rolling back means switching the checkout flag to PayCore: about 6 minutes, no restore.",
      cites: [
        { source: SOURCES.cutoverPlan, quote: "Rollback: flip checkout.provider to paycore. Measured at 6 minutes in rehearsal.", page: 7 },
        { source: SOURCES.runbook, quote: "A rollback never needs a database restore.", page: 9 },
      ],
    },
    {
      key: "declines", section: "rollback", written: "2026-03-27",
      text: "If card declines pass 2% during peak hours, roll back first and investigate after.",
      claim: "Declines above 2% at peak trigger an immediate rollback.",
      cites: [{ source: SOURCES.declinesThread, quote: "Anything over 2% declines at peak, roll back first. We can look at it after." }],
    },
    {
      key: "owners", section: "who", written: "2026-03-30",
      text: "Wes Davis owns the deploy scripts. Patty McKee chairs the change advisory board.",
      claim: "Wes Davis owns the deploy scripts; Patty McKee chairs the CAB.",
      cites: [
        { source: SOURCES.cabMinutes, quote: "Chair: Patty McKee.", page: 1 },
        { source: SOURCES.opsChannel, quote: "deploy scripts are mine now, ping me not Brent" },
      ],
    },
    {
      key: "manual-steps", section: "who", written: "2026-04-01",
      text: "The manual steps nobody wrote down are in Brent's handover walkthrough.",
      claim: "Brent's handover walkthrough covers the undocumented manual deploy steps.",
      cites: [{ source: SOURCES.handover, quote: "None of this is written down, so watch this part twice." }],
    },
  ],
};

// THE DEPLOY-WINDOW LINE after April's CAB minutes
export const DEPLOY_WINDOW_KEY = "deploy-window";
export const DEPLOY_WINDOW_NEW: ArticleLine = {
  key: DEPLOY_WINDOW_KEY, section: "deploy", written: "2026-04-14",
  text: "Production deploys run on Fridays from 20:00 to 23:00, once the change advisory board signs off on Wednesday.",
  claim: "Phoenix production deploys run Fridays 20:00 to 23:00, after CAB sign-off on Wednesday.",
  cites: [{ source: CAB_APRIL, quote: "From April, Phoenix deploys move to Friday 20:00 to 23:00. CAB signs off on Wednesday.", page: 1 }],
};

// The runbook after the newer file was approved
export const RUNBOOK_SETTLED: Article = { ...RUNBOOK, lines: RUNBOOK.lines.map((line) => (line.key === DEPLOY_WINDOW_KEY ? DEPLOY_WINDOW_NEW : line)) };

// BRENT'S HANDOVER: what Brent knew, from the four sources on his card
export const HANDOVER: Article = {
  key: "handover",
  id: fakeId("page", "handover"),
  title: "Brent's handover",
  sections: [
    { key: "overview", title: "Overview" },
    { key: "systems", title: "Systems he owned" },
    { key: "sev1", title: "After the Sev 1" },
    { key: "open", title: "Unfinished work" },
  ],
  lines: [
    {
      key: "h-overview", section: "overview", written: "2026-04-03",
      text: "Brent Geller was lead engineer on Phoenix until 3 April 2026. This page keeps what he knew, from his handover and the notes he left.",
      claim: "Brent Geller was Phoenix's lead engineer until 3 April 2026.",
      cites: [{ source: SOURCES.handover, quote: "Friday is my last day, so this is everything in one go." }],
    },
    {
      key: "h-gateway", section: "systems", written: "2026-04-01",
      text: "Brent set up the Ledgerly payment gateway and holds the only notes on its retry settings.",
      claim: "Brent configured the Ledgerly gateway; its retry settings are only in his notes.",
      cites: [{ source: SOURCES.handover, quote: "The retry settings are in my notes, nowhere else. Three retries, 400 ms apart." }],
    },
    {
      key: "h-settlement", section: "systems", written: "2026-02-20",
      text: "The nightly settlement job fails quietly when PayCore is slow. Check its log by 06:00.",
      claim: "The nightly settlement job fails silently on a slow PayCore; check its log by 06:00.",
      cites: [
        { source: SOURCES.postmortem, quote: "Settlement exited 0 with nothing settled. Nobody looked until 09:40." },
        { source: SOURCES.handover, quote: "First thing every morning, before six, open the settlement log." },
      ],
    },
    {
      key: "h-outage", section: "sev1", written: "2026-02-20",
      text: "The February payroll outage came from an untested change made outside the window.",
      claim: "The February Sev 1 was caused by an untested change outside the change window.",
      cites: [{ source: SOURCES.postmortem, quote: "Root cause: an untested change applied outside the approved window." }],
    },
    {
      key: "h-cab", section: "sev1", written: "2026-03-31",
      text: "Now every payroll or payment change must pass the change advisory board.",
      claim: "All payroll and payment changes now need CAB approval.",
      cites: [
        { source: SOURCES.postmortem, quote: "Action: route every payroll and payments change through CAB." },
        { source: SOURCES.unplannedWork, quote: "Unplanned payroll work fell from 14 tickets to 2 after the CAB rule." },
      ],
    },
    {
      key: "h-tickets", section: "open", written: "2026-03-31",
      text: "Twelve open tickets still name Brent. Wes Davis took over the eight about deploys.",
      claim: "Twelve open tickets name Brent; Wes Davis took the eight about deploys.",
      cites: [
        { source: SOURCES.unplannedWork, quote: "Open, assigned to B. Geller: 12.", },
        { source: SOURCES.opsChannel, quote: "taking the 8 deploy tickets off Brent's queue" },
      ],
    },
    {
      key: "h-checklist", section: "open", written: "2026-03-30",
      text: "The Ledgerly cutover checklist is half done. Brent marked steps 1 to 6 as tested.",
      claim: "Steps 1 to 6 of the Ledgerly cutover checklist are tested.",
      cites: [{ source: SOURCES.opsChannel, quote: "cutover checklist: 1-6 tested, 7-12 still open" }],
    },
  ],
};

// ROWS: ids are stable across scenes, so a line keeps its id when its text changes
export const sectionId = (article: Article, key: string) => fakeId("section", article.key, key);
export const lineId = (article: Article, key: string) => fakeId("line", article.key, key);
const lineRevisionId = (article: Article, line: ArticleLine) => fakeId("line-revision", article.key, line.key, line.written);
const unitId = (article: Article, key: string) => fakeId("unit", article.key, key);
const revisionId = (article: Article, line: ArticleLine) => fakeId("revision", article.key, line.key, line.written);
const passageId = (line: ArticleLine, index: number) => fakeId("passage", line.key, line.written, index);

export function sectionRows(article: Article): Tables<"sections">[] {
  return article.sections.map((section, position) => ({
    id: sectionId(article, section.key), page_id: article.id, title: section.title, position, body: "", mode: "generated", query: null,
    status: "current", build_cancelled: false, built_at: null, built_with_model_version: MODEL, created_at: fakeDate("2026-03-02"), retired_at: null,
  }));
}

// One shown line as the section_lines view returns it; `text` overrides the line's words (a line being retyped)
export function shownLine(article: Article, line: ArticleLine, position: number, text = line.text): ShownLine {
  return {
    lineId: lineId(article, line.key), sectionId: sectionId(article, line.section), position, lineRevisionId: lineRevisionId(article, line),
    content: text, unitRevisionIds: [revisionId(article, line)], author: "ai", authorId: null, model: MODEL, isStale: false, lastChangedAt: fakeDate(line.written, "10:15"),
  };
}

export const shownLines = (article: Article): ShownLine[] => article.lines.map((line, index) => shownLine(article, line, index));

function sourceRow(source: PhoenixSource): Tables<"sources"> {
  return {
    id: source.id, title: source.title, mime_type: source.mimeType, origin: source.origin, source_date: fakeDate(source.date), created_at: fakeDate(source.date, "12:00"),
    hash: fakeHash(source.key), storage_path: `stage/${source.key}`, byte_size: 120_000, page_count: null, replaced_by_id: null, url: null, archived_at: null, archive_reason: null,
  };
}

function passageRows(line: ArticleLine): Tables<"passages">[] {
  return line.cites.map((cite, index) => ({
    id: passageId(line, index), source_id: cite.source.id, text: cite.quote, position: index, confidence: 0.97, hash: fakeHash("passage", line.key, index),
    location: cite.page === undefined ? {} : { page: cite.page }, speaker_label: null, created_at: fakeDate(cite.source.date, "12:05"),
  }));
}

function revisionRow(article: Article, line: ArticleLine): Tables<"revisions"> {
  return {
    id: revisionId(article, line), unit_id: unitId(article, line.key), content: line.claim, title: null, passage_ids: line.cites.map((_, index) => passageId(line, index)),
    author: "ai", author_id: null, model_version: MODEL, event_id: fakeId("event", line.key, line.written), replaces_revision_id: null, knowledge_context: null, structure: null,
    source_date: fakeDate(line.written), created_at: fakeDate(line.written, "10:10"),
  };
}

// EVIDENCE: the article's numbered references, built by the app's own function. Only `cited` lines
// carry their citations (a line still being written has none yet). Figures are left out: they load
// the source file over the network.
export function articleEvidence(article: Article, lines: ShownLine[], cited: ReadonlySet<string> = new Set(lines.map((line) => line.lineId))): ArticleEvidence {
  const byId = new Map(article.lines.map((line) => [lineId(article, line.key), line]));
  const withCites = lines.filter((line) => cited.has(line.lineId));
  const used = withCites.flatMap((shown) => { const line = byId.get(shown.lineId); return line ? [line] : []; });
  const evidence = buildArticleEvidence(withCites, used.map((line) => revisionRow(article, line)), used.flatMap(passageRows), [...new Set(used.flatMap((line) => line.cites.map((cite) => cite.source)))].map(sourceRow));
  for (const line of lines) if (!evidence.byLine.has(line.lineId)) evidence.byLine.set(line.lineId, []);
  return { ...evidence, figuresByLine: new Map() };
}

const profileRow = (key: PersonKey) => ({ id: PEOPLE[key].id, display_name: PEOPLE[key].name, email: PEOPLE[key].email, created_at: fakeDate("2026-01-05"), updated_at: fakeDate("2026-01-05") });

// SEEDS for the line panel (LinePanel): the claim, its passages and sources, the line's versions,
// the people list, and no recent section changes. `previous` adds an older version to the history.
export function seedLinePanel(qc: QueryClient, article: Article, line: ArticleLine, previous?: ArticleLine) {
  const revision = revisionRow(article, line);
  qc.setQueryData(queryKeys.row("revisions", revision.id), revision);
  qc.setQueryData(queryKeys.row("units", revision.unit_id), {
    id: revision.unit_id, current_revision_id: revision.id, epistemic_status: "established", kind: "fact", origin: "observed", retired_at: null,
    created_at: revision.created_at, last_changed_at: revision.created_at, valid_from: revision.source_date, valid_to: null,
  } satisfies Tables<"units">);
  for (const passage of passageRows(line)) qc.setQueryData(queryKeys.row("passages", passage.id), passage);
  for (const cite of line.cites) qc.setQueryData(queryKeys.row("sources", cite.source.id), sourceRow(cite.source));
  const versions = [line, ...(previous ? [previous] : [])].map((version): Tables<"line_revisions"> => ({
    id: lineRevisionId(article, version), line_id: lineId(article, line.key), content: version.text, author: "ai", author_id: null, model_version: MODEL,
    event_id: fakeId("event", version.key, version.written), replaces_revision_id: null, unit_revision_ids: [revisionId(article, version)], created_at: fakeDate(version.written, "10:15"),
  }));
  qc.setQueryData(queryKeys.list("line_revisions", { orderBy: "created_at", ascending: false, filters: { line_id: lineId(article, line.key) } }), versions);
  qc.setQueryData(queryKeys.list("change_notes", { orderBy: "created_at", ascending: false, filters: { section_id: sectionId(article, line.section) }, limit: 3 }), []);
  if (qc.getQueryData(queryKeys.list("profiles", { orderBy: "created_at", ascending: true })) === undefined) {
    qc.setQueryData(queryKeys.list("profiles", { orderBy: "created_at", ascending: true }), (["bill", "wes", "patty"] as const).map(profileRow));
  }
}

// BRENT'S STAKEHOLDER CARD, as public.stakeholder_cards returns it
export const BRENT_CARD: StakeholderCard = {
  entityId: fakeId("entity", "brent"), name: PEOPLE.brent.name, type: "person", aliases: ["Brent"], kind: "person", relation: "Built and ran every Phoenix deploy until he left.",
  description: "Lead engineer at Parts Unlimited. The one person who knew how Phoenix really deploys.",
  keyFacts: [
    { label: "Role", value: "Lead engineer", unitIds: [] },
    { label: "Left", value: "3 Apr 2026", unitIds: [] },
    { label: "Handed to", value: PHOENIX_ACCOUNT.name, unitIds: [] },
  ],
  functions: [{ text: "Ledgerly payment gateway", unitIds: [] }, { text: "Nightly settlement job", unitIds: [] }],
  contacts: [], personContacts: [{ kind: "email", value: PEOPLE.brent.email, label: null }],
  hidden: false, generatedAt: fakeDate("2026-04-03"), web: null, webCheckedAt: null, logoUrl: null,
  person: { title: "Lead engineer", organization: "Parts Unlimited", organizationEntityId: null, role: "Lead engineer", unitIds: [] },
  claimCount: 31, sourceCount: 4, lastChangedAt: fakeDate("2026-04-03"), stale: false, isOurs: false,
};

// The other people beside Brent on the Stakeholders screen
export function personCard(key: PersonKey, claimCount: number, sourceCount: number, relation: string): StakeholderCard {
  const who = PEOPLE[key];
  return {
    ...BRENT_CARD, entityId: fakeId("entity", key), name: who.name, aliases: [], relation, description: null,
    keyFacts: [{ label: "Role", value: who.role, unitIds: [] }], functions: [], personContacts: [{ kind: "email", value: who.email, label: null }],
    person: { title: who.role, organization: "Parts Unlimited", organizationEntityId: null, role: who.role, unitIds: [] }, claimCount, sourceCount,
  };
}
