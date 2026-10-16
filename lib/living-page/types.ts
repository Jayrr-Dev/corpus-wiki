import type { EpistemicStatus, UnitKind } from "@/lib/ai/types";
import type { Enums } from "@/lib/database/types";

// =====================================================================
// LIVING PAGE TYPES: what the section writer is given and returns, and
// the shapes the living-page DB functions take and return (camelCase).
// Lines as rows: a section is its lines; each line cites the claims it states.
// No server-only imports: the wiki page reads these types too.
// =====================================================================

// SECTION QUERY (sections.query): defined with the action inputs that carry it
export type { SectionQuery } from "@/lib/ai/types";

// ONE UNIT A SECTION SHOWS, at its current revision
export type SectionUnit = {
  context?: import("@/lib/knowledge/context").KnowledgeContext | null;
  unitId: string;
  revisionId: string;
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
  structure?: import("@/lib/ai/types").Structure; // a composite: a procedure or a list
  memberOf?: string; // a step or item of this composite (also in the section)
  position?: number | null; // its place in the composite's sequence
};

// ONE CURRENT LINE OF A SECTION, flagged when it must be rewritten
// (a claim it cites changed, or the section no longer shows that claim)
export type SectionLine = {
  lineId: string;
  lineRevisionId: string;
  position: number;
  content: string;
  author: Enums<"actor_kind">;
  unitIds: string[];
  needsRewrite: boolean;
};

// DB: read_section_state
export type SectionState = { sectionId: string; title: string; pageTitle: string; units: SectionUnit[]; lines: SectionLine[] };

// WRITER INPUT: the section's claims and lines; only flagged lines and uncovered claims are its job
export type SectionReviseInput = {
  pageTitle: string;
  sectionTitle: string;
  units: SectionUnit[];
  lines: SectionLine[];
  uncoveredUnitIds: string[];
  updateNote?: string;
};

// WRITER OUTPUT: lines to rewrite, lines to remove, lines to add (each citing the units it states)
export type LineText = { text: string; unitIds: string[] };
export type SectionRevision = {
  revise: (LineText & { lineId: string })[];
  retire: string[];
  add: LineText[];
  modelVersion: string;
  // Usage of the call that wrote it (absent for the fake writer)
  tokensIn?: number | null;
  tokensOut?: number | null;
};

// DB FUNCTION SHAPES
export type SectionRef = { sectionId: string; pageId: string };
// rebuildRequested: another rebuild was asked for while this one ran (for rebuildEventId)
export type FinishedSectionBuild = { sectionId: string; changeNoteId: string | null; rebuildRequested?: boolean; rebuildEventId?: string | null };
