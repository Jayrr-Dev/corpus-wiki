import type { EpistemicStatus, UnitKind } from "@/lib/ai/types";

// =====================================================================
// LIVING PAGE TYPES: what the section writer is given and returns, and
// the shapes the living-page DB functions take and return (camelCase).
// No server-only imports: the wiki page reads SentenceLink too.
// =====================================================================

// SECTION QUERY (sections.query): every key optional
export type SectionQuery = {
  entity?: { type: string; key: string };
  domainPaths?: string[];
  kinds?: UnitKind[];
};

// ONE UNIT A SECTION SHOWS, at its current revision
export type SectionUnit = {
  unitId: string;
  revisionId: string;
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
};

// WRITER INPUT: the section, its page and the units it may use (and nothing else)
export type SectionWriteInput = {
  pageTitle: string;
  sectionTitle: string;
  units: SectionUnit[];
};

// WRITER OUTPUT: sentences in reading order, each citing the units it says
export type WrittenSentence = { text: string; unitIds: string[] };
export type WrittenSection = { sentences: WrittenSentence[]; modelVersion: string };

// SENTENCE LINK (sections.sentence_links): character offsets into the body
export type SentenceLink = { start: number; end: number; unitIds: string[] };

// DB FUNCTION SHAPES
export type SectionRef = { sectionId: string; pageId: string };
export type SectionUnitsRead = { sectionId: string; title: string; pageTitle: string; units: SectionUnit[] };
export type SectionBuild = {
  body: string;
  sentenceLinks: SentenceLink[];
  modelVersion: string;
  inputs: { unitId: string; revisionId: string }[];
};
export type SavedSectionBuild = { sectionId: string; changeNoteId: string | null };
