import type { EpistemicStatus, SpeechAct, UnitKind } from "../types";

// =====================================================================
// CANNED ANSWERS FOR THE EVAL FIXTURES, keyed by file name (sources.title).
// Each entry is the one claim a model should read from that file.
// =====================================================================

export type CannedClaim = {
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
  speechAct: SpeechAct;
  // true when the claim is about Alpha's database, so it revises that unit if one exists
  isDatabaseDecision: boolean;
};

// SHARED CLAIMS
const decision = (content: string): CannedClaim => ({
  content,
  kind: "decision",
  epistemicStatus: "established",
  speechAct: "decided",
  isDatabaseDecision: true,
});

const POSTGRES = decision("Alpha will use PostgreSQL.");

export const CANNED_CLAIMS: Readonly<Record<string, CannedClaim>> = {
  "e1-alpha-kickoff.md": POSTGRES,
  "e2-alpha-architecture-update.md": decision("Alpha will use MySQL."),
  "e3-alpha-kickoff-resent.md": POSTGRES,
  "e4-alpha-meeting-notes.md": {
    content: "Alpha might switch to MongoDB for its event data.",
    kind: "fact",
    epistemicStatus: "hypothesis",
    speechAct: "asked",
    isDatabaseDecision: false,
  },
  "e5-alpha-decision-memo.md": POSTGRES,
  "e5-alpha-standup-notes.md": POSTGRES,
  "e6-alpha-db-review-a.md": decision("Alpha will use MySQL."),
  "e6-alpha-db-review-b.md": decision("Alpha will use CockroachDB."),
};

// WHERE NEW ALPHA CLAIMS ARE FILED (matches supabase/seed.sql)
export const ALPHA_ENTITY = { type: "project", key: "alpha" } as const;
export const ALPHA_DATA_DOMAIN = "Projects/Alpha/Data layer";
export const ALPHA_DOMAIN = "Projects/Alpha";
