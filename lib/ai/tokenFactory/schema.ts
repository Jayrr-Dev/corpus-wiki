import { z } from "zod";
import { Constants } from "@/lib/database/types";

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

// AN ENTITY A CLAIM IS ABOUT (created when the store does not have it yet)
const entityRefSchema = z.object({
  type: z.string().min(1),
  key: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(ENUMS.entity_role),
});

// ONE CLAIM READ FROM THE FILE
const claimSchema = z.object({
  action: z.enum(CLAIM_ACTIONS),
  unit: z.string().nullable(),
  content: z.string(),
  kind: z.enum(ENUMS.unit_kind),
  epistemicStatus: z.enum(ENUMS.epistemic_status),
  speechAct: z.enum(ENUMS.speech_act),
  passages: z.array(z.string()),
  entities: z.array(entityRefSchema),
  domainPaths: z.array(z.string()),
  reason: z.string(),
});

// ONE LINK BETWEEN TWO CLAIMS: from and to are claim refs (C1 = this answer's first claim)
// or existing unit refs (U1). Older answers without links parse as having none.
const linkSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(ENUMS.relationship_type),
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
