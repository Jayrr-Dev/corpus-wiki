import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { Embedder } from "@/lib/ai/embeddings";
import { buildJudgeMessages, judgeAnswerJsonSchema, judgeAnswerSchema, readJudgeAnswer } from "@/lib/ai/tokenFactory/duplicateJudge";
import type { DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import { embedMissingUnits, similarUnits } from "@/lib/knowledge/embeddingStore";
import { CANDIDATE_COSINE } from "@/lib/knowledge/similarity";
import { type GuardOptions, guardDuplicates } from "./duplicateGuard";

// THE GUARD AS THE APP RUNS IT: stored claims missing a vector are embedded first (so a
// failed earlier embed heals), then the draft is checked against the store with the judge.
export function duplicateGuardFor(db: DbRpc, settings: TokenFactorySettings, embedder: Embedder | null) {
  return async (input: ReconciliationInput, draft: DraftChangeSet, options?: GuardOptions): Promise<DraftChangeSet> => {
    if (embedder) {
      try { await embedMissingUnits(db, embedder); }
      catch (error) { console.error("Stored claims could not be embedded before the duplicate check:", error); }
    }
    return guardDuplicates({
      embedder,
      findSimilar: (vector) => (embedder ? similarUnits(db, embedder.model, vector, 5, CANDIDATE_COSINE) : Promise.resolve([])),
      judge: async (request) => {
        const answer = await chatJson(settings, {
          name: "duplicate_judge",
          subject: input.source.title,
          schema: judgeAnswerSchema,
          jsonSchema: judgeAnswerJsonSchema,
          messages: buildJudgeMessages(request),
        });
        return readJudgeAnswer(answer.value, request);
      },
    }, input, draft, options);
  };
}
