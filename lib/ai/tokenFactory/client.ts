import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { PROMPT_VERSION } from "@/lib/ai/config";
import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { buildReconciliationMessages } from "./prompt";
import { reconciliationAnswerSchema, reconciliationJsonSchema } from "./schema";
import { answerToActions } from "./toDraft";

// REAL CLIENT: one call per uploaded file to NVIDIA Nemotron on Nebius Token Factory
export class TokenFactoryReconciliationClient implements ReconciliationClient {
  readonly name = "token-factory";

  constructor(private readonly settings: TokenFactorySettings) {}

  // Sends the file and the store; turns the answer into typed actions for Change control
  async draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet> {
    const answer = await chatJson(this.settings, {
      name: "reconciliation",
      schema: reconciliationAnswerSchema,
      jsonSchema: reconciliationJsonSchema,
      messages: buildReconciliationMessages(input),
    });
    return {
      summary: answer.value.summary.trim() || `Read ${input.source.title}`,
      actions: answerToActions(answer.value, input),
      trace: { modelVersion: answer.model, promptVersion: PROMPT_VERSION, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut },
    };
  }
}
