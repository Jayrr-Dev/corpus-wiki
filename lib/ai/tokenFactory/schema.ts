import { z } from "zod";
import { Constants } from "@/lib/database/types";
import { ENTITY_TYPES, normalizeEntityType } from "@/lib/knowledge/entityTypes";
import { SENIORITIES, STRUCTURE_LINK_TYPES } from "@/lib/stakeholders/structure";

// =====================================================================
// WHAT NEMOTRON MUST ANSWER: claims, each one typed action on the store,
// and typed links between claims. Passages, units and this answer's own
// claims are named by short refs (P1, U1, C1) instead of UUIDs,
// so the model never has to copy an id. lib/ai/tokenFactory/toDraft.ts
// turns the answer into a DraftChangeSet.
// =====================================================================

// ENUM VALUES FROM THE DATABASE (one source)
const ENUMS = Constants.public.Enums;

// WHAT A CLAIM DOES TO THE STORE
export const CLAIM_ACTIONS = ["add", "revise", "retire", "set_status"] as const;

// AN ENTITY'S TYPE: one from the fixed list (guided decoding offers only these); a word from
// an older answer ("law", "country") is mapped onto the list when it is read back
const entityTypeSchema = z.preprocess(normalizeEntityType, z.enum(ENTITY_TYPES));

// AN ENTITY A CLAIM IS ABOUT (created when the store does not have it yet)
const entityRefSchema = z.object({
  type: entityTypeSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(ENUMS.entity_role),
});

// Optional only for historical answers; new model output supplies explicit applicability.
export const applicabilitySchema = z.object({
  status: z.enum(["unspecified", "general", "scoped"]),
  entities: z.array(z.object({ type: entityTypeSchema, key: z.string().min(1), name: z.string().min(1) })),
  conditions: z.string().nullable(),
});

// A COMPOSITE'S SHAPE (revisions.structure): a procedure's ordered steps, or a list's items
export const structureSchema = z.object({
  type: z.enum(["sequence", "set"]),
  complete: z.boolean(),
  mode: z.enum(["all", "any"]).nullable(),
});

// HOW TWO OF THE CLAIM'S ENTITIES SIT TOGETHER (lib/stakeholders/structure.ts): who is inside
// whom and who presses on whom, from the smaller or lower end to the bigger. toDraft.ts keeps it
// as knowledge_context.structure; the answer field has its own name because "structure" above
// is a composite's shape.
const structureLabelSchema = z.object({
  from: z.object({ type: entityTypeSchema, key: z.string().min(1) }),
  link: z.enum(STRUCTURE_LINK_TYPES),
  to: z.object({ type: entityTypeSchema, key: z.string().min(1) }),
  title: z.string().nullable(),
  seniority: z.enum(SENIORITIES).nullable(),
  share: z.number().min(0).max(1).nullable(),
  current: z.boolean(),
  // When the seat, membership or ownership started and ended ("2019", "2021-03"); toDraft.ts drops a
  // value that is not a partial date. Required in guided decoding; labels from before dates have none.
  since: z.string().nullable().default(null),
  until: z.string().nullable().default(null),
});

// ONE CLAIM READ FROM THE FILE
const claimSchema = z.object({
  action: z.enum(CLAIM_ACTIONS),
  unit: z.string().nullable(),
  content: z.string(),
  title: z.string(),
  kind: z.enum(ENUMS.unit_kind),
  epistemicStatus: z.enum(ENUMS.epistemic_status),
  speechAct: z.enum(ENUMS.speech_act),
  passages: z.array(z.string()),
  entities: z.array(entityRefSchema),
  applicability: applicabilitySchema.optional(),
  domainPaths: z.array(z.string()),
  // Set only on a composite; older answers have none
  structure: structureSchema.nullable().optional(),
  // Required in guided decoding (an empty list when the passage states none); older answers have none
  stakeholderLinks: z.array(structureLabelSchema).default([]),
  reason: z.string(),
});

// ONE LINK BETWEEN TWO CLAIMS: from and to are claim refs (C1 = this answer's first claim)
// or existing unit refs (U1). Older answers without links parse as having none.
const linkSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(ENUMS.relationship_type),
  // A part_of step's place in its sequence (1 first); null otherwise. Older answers have none.
  position: z.number().int().nullable().optional(),
  reason: z.string(),
});

export const reconciliationAnswerSchema = z.object({
  summary: z.string(),
  claims: z.array(claimSchema),
  links: z.array(linkSchema).default([]),
});

// stakeholderLinks stays optional on the type, so claims built in code without it still fit
export type AnswerClaim = Omit<z.infer<typeof claimSchema>, "stakeholderLinks"> & { stakeholderLinks?: AnswerStructureLabel[] };
export type AnswerStructureLabel = z.infer<typeof structureLabelSchema>;
export type ReconciliationAnswer = Omit<z.infer<typeof reconciliationAnswerSchema>, "claims"> & { claims: AnswerClaim[] };
export type AnswerEntityRef = z.infer<typeof entityRefSchema>;
export type AnswerLink = z.infer<typeof linkSchema>;

// THE SAME SHAPE AS JSON SCHEMA, for Token Factory's guided decoding
export const reconciliationJsonSchema = z.toJSONSchema(reconciliationAnswerSchema);
