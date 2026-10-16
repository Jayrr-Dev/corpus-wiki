import { z } from "zod";
import { Constants } from "@/lib/database/types";
import { ENTITY_TYPES, normalizeEntityType } from "@/lib/knowledge/entityTypes";

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

export type ReconciliationAnswer = z.infer<typeof reconciliationAnswerSchema>;
export type AnswerClaim = z.infer<typeof claimSchema>;
export type AnswerEntityRef = z.infer<typeof entityRefSchema>;
export type AnswerLink = z.infer<typeof linkSchema>;

// THE SAME SHAPE AS JSON SCHEMA, for Token Factory's guided decoding
export const reconciliationJsonSchema = z.toJSONSchema(reconciliationAnswerSchema);
