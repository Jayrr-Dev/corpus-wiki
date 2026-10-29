import { type GmailApi, type GmailLabel, gmailApi } from "./api";
import { openTokens, sealTokens } from "./crypto";
import { type ImportDeps, type ImportSummary, importLabels } from "./importer";
import { type Fetch, type GmailTokens, type GoogleClient, exchangeCode, refreshTokens, revokeTokens, tokensFresh } from "./oauth";
import type { GmailStore } from "./store";

// =====================================================================
// GMAIL IMPORT SERVICE: connect, labels, import and disconnect for one
// person. Tokens are opened only here, on the server, to call Google;
// what it returns to callers (and so to the browser) never holds them.
// =====================================================================

export type GmailServiceDeps = { store: GmailStore; fetch: Fetch; key: Buffer; client: GoogleClient; now?: () => number };

// WHAT THE SETTINGS CARD SEES: no tokens, ever
export type GmailStatus = { connected: false } | { connected: true; accountEmail: string; labelIds: string[]; lastImportAt: string | null };

export type ImportResult = Omit<ImportSummary, "eventIds">;

const LABEL_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function gmailService(deps: GmailServiceDeps) {
  const now = deps.now ?? Date.now;

  // A Gmail client for the person's stored tokens, refreshing (and saving) them when they expire
  const apiFor = (personId: string, tokenCipher: string): GmailApi => {
    let tokens = openTokens<GmailTokens>(deps.key, personId, tokenCipher);
    return gmailApi(deps.fetch, async () => {
      if (!tokensFresh(tokens, now())) {
        tokens = await refreshTokens(deps.fetch, deps.client, tokens, now());
        await deps.store.saveTokens(personId, sealTokens(deps.key, personId, tokens));
      }
      return tokens.accessToken;
    });
  };

  const requireConnection = async (personId: string) => {
    const connection = await deps.store.connection(personId);
    if (!connection) throw new Error("Connect a Google account first.");
    return connection;
  };

  return {
    async status(personId: string): Promise<GmailStatus> {
      const connection = await deps.store.connection(personId);
      if (!connection) return { connected: false };
      return { connected: true, accountEmail: connection.accountEmail, labelIds: connection.labelIds, lastImportAt: connection.lastImportAt };
    },

    // OAuth callback: the code becomes tokens, sealed and stored with the account's address
    async completeConnect(personId: string, code: string, verifier: string): Promise<{ accountEmail: string }> {
      const tokens = await exchangeCode(deps.fetch, deps.client, code, verifier, now());
      const accountEmail = await gmailApi(deps.fetch, async () => tokens.accessToken).profileEmail();
      await deps.store.saveConnection(personId, accountEmail, sealTokens(deps.key, personId, tokens));
      return { accountEmail };
    },

    async labels(personId: string): Promise<GmailLabel[]> {
      const connection = await requireConnection(personId);
      return apiFor(personId, connection.tokenCipher).listLabels();
    },

    async setLabels(personId: string, labelIds: unknown): Promise<string[]> {
      if (!Array.isArray(labelIds) || !labelIds.every((id) => typeof id === "string" && LABEL_ID.test(id))) throw new Error("Those labels are not valid.");
      const unique = [...new Set(labelIds as string[])];
      if (unique.length > 100) throw new Error("Pick at most 100 labels.");
      if (!(await deps.store.setLabels(personId, unique))) throw new Error("Connect a Google account first.");
      return unique;
    },

    async importNow(personId: string, ingest: Pick<ImportDeps, "startThread" | "startAttachment">): Promise<ImportSummary> {
      const connection = await requireConnection(personId);
      const summary = await importLabels(
        { api: apiFor(personId, connection.tokenCipher), store: deps.store, ...ingest },
        { accountEmail: connection.accountEmail, labelIds: connection.labelIds },
      );
      await deps.store.markImported(personId);
      return summary;
    },

    // Deletes the stored tokens; Google is also asked to end the grant (best effort)
    async disconnect(personId: string): Promise<{ revoked: boolean }> {
      const connection = await deps.store.connection(personId);
      if (!connection) return { revoked: false };
      let revoked = false;
      try {
        revoked = await revokeTokens(deps.fetch, openTokens<GmailTokens>(deps.key, personId, connection.tokenCipher));
      } catch {
        // Tokens that cannot be opened are still deleted below
      }
      await deps.store.deleteConnection(personId);
      return { revoked };
    },
  };
}

export type GmailService = ReturnType<typeof gmailService>;
