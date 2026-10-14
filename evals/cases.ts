// =====================================================================
// EVAL CASES E1–E7 (Build Plan, step 5). Each case starts from the seed
// baseline (supabase/seed.sql: Project Alpha with no database decision)
// and runs its steps in order. `expected` is what the store must show after.
// File dates live in each fixture's first line ("Date: YYYY-MM-DD") and
// are repeated here; evals/fixtures.test.ts checks the two agree.
// =====================================================================

export type FixtureFile = { file: string; date: string };

export type EvalStep =
  | { kind: "upload"; fixture: FixtureFile }
  | { kind: "undo"; ofStep: number }; // undo the ChangeSet produced by step N (0-based)

// WHAT THE STORE MUST SHOW AFTER THE LAST STEP
export type EvalExpectation = {
  databaseUnits: number; // current units about Alpha's database (kind decision)
  currentContent?: string; // that unit's current revision content
  revisionCount?: number; // revisions of that unit, old ones kept
  sourcesCited?: number; // distinct sources behind the current revision
  hypothesisUnits?: number; // units with epistemic_status hypothesis
  openExceptions?: number;
  lastStepChanges: boolean; // did the last step change any unit?
  note: string;
};

export type EvalCase = { id: string; name: string; steps: EvalStep[]; expected: EvalExpectation };

// FIXTURE FILES (evals/fixtures)
export const FIXTURES = {
  e1: { file: "e1-alpha-kickoff.md", date: "2026-09-01" },
  e2: { file: "e2-alpha-architecture-update.md", date: "2026-09-20" },
  // Same text and date as E1 but not byte-identical: an identical file is skipped
  // earlier by sources.hash, so this one proves the source-date check instead.
  e3: { file: "e3-alpha-kickoff-resent.md", date: "2026-09-01" },
  e4: { file: "e4-alpha-meeting-notes.md", date: "2026-09-25" },
  e5a: { file: "e5-alpha-decision-memo.md", date: "2026-09-10" },
  e5b: { file: "e5-alpha-standup-notes.md", date: "2026-09-12" },
  e6a: { file: "e6-alpha-db-review-a.md", date: "2026-10-01" },
  e6b: { file: "e6-alpha-db-review-b.md", date: "2026-10-01" },
} as const satisfies Record<string, FixtureFile>;

// STEP HELPERS
const upload = (fixture: FixtureFile): EvalStep => ({ kind: "upload", fixture });

export const EVAL_CASES: readonly EvalCase[] = [
  {
    id: "E1",
    name: "Decision",
    steps: [upload(FIXTURES.e1)],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use PostgreSQL.",
      revisionCount: 1,
      sourcesCited: 1,
      lastStepChanges: true,
      note: "One decision unit, citing its passage.",
    },
  },
  {
    id: "E2",
    name: "Revision",
    steps: [upload(FIXTURES.e1), upload(FIXTURES.e2)],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use MySQL.",
      revisionCount: 2,
      lastStepChanges: true,
      note: "The same unit revised, the old revision kept, the page section rewritten.",
    },
  },
  {
    id: "E3",
    name: "Older file",
    steps: [upload(FIXTURES.e1), upload(FIXTURES.e2), upload(FIXTURES.e3)],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use MySQL.",
      revisionCount: 2,
      openExceptions: 0,
      lastStepChanges: false,
      note: "No change: the E3 passage is older than the unit's current revision.",
    },
  },
  {
    id: "E4",
    name: "Proposal",
    steps: [upload(FIXTURES.e4)],
    expected: {
      databaseUnits: 0,
      hypothesisUnits: 1,
      lastStepChanges: true,
      note: "A hypothesis unit, not a decision.",
    },
  },
  {
    id: "E5",
    name: "Duplicate",
    steps: [upload(FIXTURES.e5a), upload(FIXTURES.e5b)],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use PostgreSQL.",
      sourcesCited: 2,
      lastStepChanges: true,
      note: "One unit, two sources.",
    },
  },
  {
    id: "E6",
    name: "Contradiction",
    steps: [upload(FIXTURES.e6a), upload(FIXTURES.e6b)],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use MySQL.",
      openExceptions: 1,
      lastStepChanges: false,
      note: "Same source date, different decisions: one source_tie exception sent to the person.",
    },
  },
  {
    id: "E7",
    name: "Undo",
    steps: [upload(FIXTURES.e1), upload(FIXTURES.e2), { kind: "undo", ofStep: 1 }],
    expected: {
      databaseUnits: 1,
      currentContent: "Alpha will use PostgreSQL.",
      lastStepChanges: true,
      note: "Undo E2: the unit and the page return to E1.",
    },
  },
];
