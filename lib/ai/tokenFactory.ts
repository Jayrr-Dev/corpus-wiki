import { TOKEN_FACTORY_BASE_URL } from "./config";
import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "./types";

type TokenFactoryOptions = { apiKey: string; model: string | undefined; baseUrl?: string };

// REAL CLIENT (STUB): agent C implements the call to Token Factory here
export class TokenFactoryReconciliationClient implements ReconciliationClient {
  readonly name = "token-factory";
  readonly baseUrl: string;

  constructor(private readonly options: TokenFactoryOptions) {
    this.baseUrl = options.baseUrl ?? TOKEN_FACTORY_BASE_URL;
  }

  // Not built yet: throws so a missing implementation can never pass silently
  async draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet> {
    void input;
    throw new Error("TokenFactoryReconciliationClient.draftChangeSet is not implemented (agent C).");
  }
}
