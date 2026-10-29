import type { Enums } from "@/lib/database/types";
import type { KnowledgeContext } from "@/lib/knowledge/context";

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
  context?: KnowledgeContext | null;
  unitId: string;
  revisionId: string; // current revision; becomes the action's expectedRevisionId
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
  sourceDate: string; // newest source behind the current revision (ISO)
  passageIds: string[];
  structure?: Structure | null; // set on a composite (a procedure, a list)
  memberUnitIds?: string[]; // a composite's members, in order
};

// COMPOSITE: a claim that holds the shape of others (revisions.structure). Its members
// link to it with part_of; a sequence orders them (relationships.position, 1 first).
// complete: the source says the list is exhaustive. mode (sets only): every item applies, or any one.
export type Structure = { type: "sequence" | "set"; complete: boolean; mode: "all" | "any" | null };

// INPUT: an existing entity the model may name in a claim
export type ExistingEntity = { type: string; key: string; name: string };

export type ReconciliationInput = {
  domainTabs?: { name: string; description: string; rootPaths: string[] }[];
  // An upload's claims are filed into topics after they are saved (lib/ai/tokenFactory/placeTopics.ts):
  // extraction leaves domainPaths empty and is not shown the topic tree
  fileTopicsLater?: boolean;
  externalScope?: { article: string; section: string; note: string; referenceDomainPaths: string[]; fallbackDomainPath?: string };
  source: { id: string; title: string; sourceDate: string };
  passages: ReconciliationPassage[];
  existingUnits: ExistingUnit[];
  domainPaths: string[]; // the domain tree, e.g. 'Projects/Alpha/Data layer'
  entities: ExistingEntity[];
};

// ACTION INPUTS (stored in actions.input). Entities and domains are referenced by
// natural key / path so an action can use what an earlier action in the set creates.
// rationale: the model's own words on why it proposed the action, shown when a person reviews it.
export type EntityRef = { type: string; key: string; role: EntityRole };

export type ActionInputByType = {
  glossary_update: { title: string; operation: string; total: number; added: string[]; revised: string[]; removed: string[] };
  source_lifecycle: { title: string; operation: string; reason: string };
  source_review: { title: string; stage: string; outcome: string; reason: string };
  create_domain: { name: string; path: string; parentPath: string | null; domainTabId?: string };
  create_entity: { type: string; key: string; name: string; aliases: string[] };
  add_claim: {
    context?: KnowledgeContext;
    content: string;
    title?: string; // short name that tells it apart on its topic (revisions.title)
    kind: UnitKind;
    epistemicStatus: EpistemicStatus;
    validFrom: string;
    entities: EntityRef[];
    domainPaths: string[];
    structure?: Structure;
    rationale?: string;
  };
  // structure: omitted keeps the composite's shape; null clears it
  revise_claim: { context?: KnowledgeContext; structure?: Structure | null; content: string; title?: string; epistemicStatus?: EpistemicStatus; validFrom?: string; rationale?: string };
  retire_claim: { reason: string; validTo: string | null };
  // target = the unit that is kept; autoMerge: an AI merge sure enough to skip review (check_deletion)
  merge_duplicates: { duplicateUnitIds: string[]; autoMerge?: boolean; rationale?: string };
  // target = the unit; its topics become these paths (an upload files its claims after cleaning them)
  place_claim: { domainPaths: string[]; rationale?: string };
  // target = the "from" unit. A unit an earlier action of the same set creates is
  // named by that action's position instead (fromPosition / toPosition).
  // memberPosition: a part_of step's place in its sequence (not an action position)
  link: { toUnitId: string | null; type: RelationshipType; fromPosition?: number; toPosition?: number; memberPosition?: number; rationale?: string };
  // target = the composite; moves a member (position, sequences only) or takes it out
  set_member: { memberUnitId: string; position?: number; remove?: boolean; rationale?: string };
  set_epistemic_status: { epistemicStatus: EpistemicStatus; rationale?: string };
  // LINES AS ROWS: a wiki line cites the claim revisions it states. citePositions names
  // claim revisions an earlier action of the same set creates (a line edit that revises its claim).
  write_line: { sectionId: string; position: number; content: string; unitRevisionIds: string[]; citePositions?: number[] };
  revise_line: { content: string; unitRevisionIds: string[]; citePositions?: number[]; expectedLineRevisionId: string };
  retire_line: { expectedLineRevisionId: string };
  move_line: { position: number; expectedLineRevisionId: string };
  // PAGES: presentation, changed through the same ChangeSets so they are audited and undoable.
  // target = the page or section; a create records the new row in target_id once applied.
  create_page: { title: string; entityId: string | null; sections: SectionDraft[]; articleType?: "entity" | "process" | "requirement" | "concept"; scope?: string; parentPageId?: string | null };
  rename_page: { title: string };
  review_page: { operation: string; recommendation: string; reason: string; quote: string; guideline: string; destinationId: string | null; pageSlug: string; pageTitle: string };
  retire_page: Record<string, never>;
  // A VERY LARGE UPLOAD'S BUILD, held for a person (no target; changes no content). See lib/living-page/reviewerBudget.ts
  approve_reviewer_budget: { sections: number; estimate: number; budget: number; reason: string };
  // THE CURATOR'S PAGE-STRUCTURE CHANGE (target = the page; for a merge, the page that goes away).
  // A merge adds the claims the kept page lacks (unitIds) as one section there and moves the child pages over.
  update_page: { curator: true; operation: "merge" | "move" | "rename" | "set_type" | "group"; confident: boolean; reason: string; pageIds?: string[];
    intoPageId?: string; sectionTitle?: string; unitIds?: string[]; parentPageId?: string | null; title?: string;
    articleType?: "entity" | "process" | "requirement" | "concept"; scope?: string };
  create_section: { pageId: string; position?: number } & SectionDraft; // position: where it goes (default: last)
  rename_section: { title: string };
  retire_section: Record<string, never>;
  // The section keeps its id and lines; added claims become uncovered, removed claims flag their lines.
  update_section_query: { query: SectionQuery; fromQuery: unknown };
  // CATALOG EDITS (a person's, from the Entities and Domains screens). target = the entity or domain.
  // Type and key never change: they are the natural key earlier actions use.
  update_entity: { name: string; aliases: string[] };
  retire_entity: { reason: string; housekeeping?: boolean }; // housekeeping: the AI retires an entity nothing uses
  // ENTITY MERGE (the AI's cleanup after an upload). target = the duplicate; it folds into intoEntityId
  merge_entity: { intoEntityId: string; reason: string; autoMerge?: boolean };
  // ENTITY RETYPE (the reclassify pass). target = the entity; fromType guards against a stale proposal
  retype_entity: { type: string; fromType: string; reason: string };
  update_domain: { name: string }; // the path, and every path under it, follows the new name
  retire_domain: { reason: string }; // retires its subtree too
};

// SECTION QUERY (sections.query): which claims a generated section shows; every key optional
export type SectionQuery = {
  unitIds?: string[];
  article?: boolean;
  articleAliases?: string[];
  entity?: { type: string; key: string };
  domainPaths?: string[];
  kinds?: UnitKind[];
  // A Docs page section (lib/living-page/docsStyle.ts): written as doc blocks by the Docs writer;
  // "intro" is the page's opening paragraph, shown under the title without a heading
  style?: "doc";
  docPart?: "intro" | "task";
};

// A NEW GENERATED SECTION: its title and the query that picks its claims
export type SectionDraft = { title: string; query: SectionQuery };

// One typed action; `type` decides the shape of `input` (a discriminated union)
export type DraftAction = {
  [K in ActionType]: {
    type: K;
    input: ActionInputByType[K] & { rationaleReferences?: import("./unitReferences").UnitReference[] };
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
  trace: { modelVersion: string | null; promptVersion: string | null; tokensIn: number | null; tokensOut: number | null;
    articleScaffold?: { keepSectionIds: string[]; replaceSectionIds: string[]; sections: { title: string; unitIds: string[]; position: number }[] } };
};

// THE SEAM: one call per uploaded file
export interface ReconciliationClient {
  readonly name: string;
  // Compares drafts with stored claims found by meaning (the split client): the pipeline embeds passages first
  readonly readsNeighborhood?: boolean;
  draftChangeSet(input: ReconciliationInput, publish?: PublishKnowledgeBatch): Promise<DraftChangeSet>;
}

export type SavedKnowledgeAction = { position: number; unitId: string | null; type: string; outcome: string };
export type PublishKnowledgeBatch = (key: string, draft: DraftChangeSet) => Promise<SavedKnowledgeAction[]>;
