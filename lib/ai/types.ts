import type { Enums } from "@/lib/database/types";

// =====================================================================
// RECONCILIATION SEAM: what the model is given and what it must return.
// Provider-neutral: the fake and any real client (agent C) implement the
// same interface. Enum values come from the generated database types.
// =====================================================================

// ENUM ALIASES (from lib/database/types.ts, never retyped)
export type ActionType = Enums<"action_type">;
export type SpeechAct = Enums<"speech_act">;
export type UnitKind = Enums<"unit_kind">;
export type EpistemicStatus = Enums<"epistemic_status">;
export type EntityRole = Enums<"entity_role">;
export type RelationshipType = Enums<"relationship_type">;

// INPUT: the uploaded file's passages
export type ReconciliationPassage = {
  id: string;
  position: number;
  text: string;
  speakerLabel: string | null;
};

// INPUT: an existing unit the model may revise, retire, link or merge
export type ExistingUnit = {
  unitId: string;
  revisionId: string; // current revision; becomes the action's expectedRevisionId
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
  sourceDate: string; // newest source behind the current revision (ISO)
  passageIds: string[];
};

// INPUT: an existing entity the model may name in a claim
export type ExistingEntity = { type: string; key: string; name: string };

export type ReconciliationInput = {
  source: { id: string; title: string; sourceDate: string };
  passages: ReconciliationPassage[];
  existingUnits: ExistingUnit[];
  domainPaths: string[]; // the domain tree, e.g. 'Projects/Alpha/Data layer'
  entities: ExistingEntity[];
};

// ACTION INPUTS (stored in actions.input). Entities and domains are referenced by
// natural key / path so an action can use what an earlier action in the set creates.
export type EntityRef = { type: string; key: string; role: EntityRole };

export type ActionInputByType = {
  create_domain: { name: string; path: string; parentPath: string | null };
  create_entity: { type: string; key: string; name: string; aliases: string[] };
  add_claim: {
    content: string;
    kind: UnitKind;
    epistemicStatus: EpistemicStatus;
    validFrom: string;
    entities: EntityRef[];
    domainPaths: string[];
  };
  revise_claim: { content: string; epistemicStatus?: EpistemicStatus; validFrom?: string };
  retire_claim: { reason: string; validTo: string | null };
  merge_duplicates: { duplicateUnitIds: string[] }; // target = the unit that is kept
  // target = the "from" unit. A unit an earlier action of the same set creates is
  // named by that action's position instead (fromPosition / toPosition).
  link: { toUnitId: string | null; type: RelationshipType; fromPosition?: number; toPosition?: number };
  set_epistemic_status: { epistemicStatus: EpistemicStatus };
};

// One typed action; `type` decides the shape of `input` (a discriminated union)
export type DraftAction = {
  [K in ActionType]: {
    type: K;
    input: ActionInputByType[K];
    targetId: string | null; // unit, entity or domain it changes; null for creates
    expectedRevisionId: string | null; // the unit's revision the model saw
    passageIds: string[];
    speechAct: SpeechAct | null;
  };
}[ActionType];

// OUTPUT: a draft ChangeSet; Change control (agent B) checks and commits it
export type DraftChangeSet = {
  summary: string;
  actions: DraftAction[];
  trace: { modelVersion: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null };
};

// THE SEAM: one call per uploaded file
export interface ReconciliationClient {
  readonly name: string;
  draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet>;
}
