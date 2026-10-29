import type { DbRpc } from "@/lib/db/rpc";

// =====================================================================
// GMAIL IMPORT STORE: public.gmail_connections and gmail_imported_threads
// through the database function port (supabase/migrations/
// 20261120020000_gmail_import.sql), so tests pass a fake DbRpc.
// tokenCipher is sealed by ./crypto and never leaves the server.
// =====================================================================

export type StoredConnection = { accountEmail: string; tokenCipher: string; labelIds: string[]; connectedAt: string; lastImportAt: string | null };

export function gmailStore(db: DbRpc) {
  return {
    async connection(personId: string): Promise<StoredConnection | null> {
      const row = await db.call<StoredConnection | null>("gmail_get_connection", { p_person_id: personId });
      return row ? { ...row, labelIds: row.labelIds ?? [] } : null;
    },
    async saveConnection(personId: string, accountEmail: string, tokenCipher: string): Promise<void> {
      await db.call("gmail_save_connection", { p_person_id: personId, p_account_email: accountEmail, p_token_cipher: tokenCipher });
    },
    async saveTokens(personId: string, tokenCipher: string): Promise<void> {
      await db.call("gmail_save_tokens", { p_person_id: personId, p_token_cipher: tokenCipher });
    },
    async setLabels(personId: string, labelIds: string[]): Promise<boolean> {
      return db.call<boolean>("gmail_set_labels", { p_person_id: personId, p_label_ids: labelIds });
    },
    async deleteConnection(personId: string): Promise<boolean> {
      return db.call<boolean>("gmail_delete_connection", { p_person_id: personId });
    },
    async markImported(personId: string): Promise<void> {
      await db.call("gmail_mark_imported", { p_person_id: personId });
    },
    // Which of these threads the current Space already imported
    async importedThreadIds(accountEmail: string, threadIds: string[]): Promise<Set<string>> {
      if (threadIds.length === 0) return new Set();
      return new Set(await db.call<string[]>("gmail_imported_thread_ids", { p_account_email: accountEmail, p_thread_ids: threadIds }));
    },
    async recordThread(accountEmail: string, threadId: string, sourceId: string | null): Promise<void> {
      await db.call("gmail_record_thread", { p_account_email: accountEmail, p_thread_id: threadId, p_source_id: sourceId });
    },
  };
}

export type GmailStore = ReturnType<typeof gmailStore>;
