import type { Fetch } from "./oauth";

// =====================================================================
// GMAIL API (read only): labels, the threads under a label, one thread
// in full, and one attachment's bytes. Every call is a GET.
// =====================================================================

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailLabel = { id: string; name: string; type: "system" | "user" };

// The parts of a Gmail message this import reads (format=full)
export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
};
export type GmailMessage = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: GmailMessagePart };
export type GmailThread = { id: string; messages?: GmailMessage[] };

export type GmailApi = {
  profileEmail(): Promise<string>;
  listLabels(): Promise<GmailLabel[]>;
  listThreadIds(labelId: string, limit: number): Promise<string[]>;
  getThread(threadId: string): Promise<GmailThread>;
  getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
};

// Labels people file mail under come first; system labels people rarely pick are left out
const HIDDEN_SYSTEM_LABELS = new Set(["CHAT", "DRAFT", "SPAM", "TRASH", "UNREAD"]);

export function gmailApi(fetchImpl: Fetch, accessToken: () => Promise<string>): GmailApi {
  const get = async <T>(path: string, query: Record<string, string> = {}): Promise<T> => {
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json" } });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(`Gmail answered ${response.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
    }
    return (await response.json()) as T;
  };

  return {
    async profileEmail() {
      const profile = await get<{ emailAddress?: string }>("/profile");
      if (!profile.emailAddress) throw new Error("Gmail did not say which account this is.");
      return profile.emailAddress;
    },
    async listLabels() {
      const { labels = [] } = await get<{ labels?: { id: string; name: string; type?: string }[] }>("/labels");
      return labels
        .filter((label) => !(label.type === "system" && HIDDEN_SYSTEM_LABELS.has(label.id)))
        .map((label) => ({ id: label.id, name: label.name, type: label.type === "system" ? "system" as const : "user" as const }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "user" ? -1 : 1));
    },
    async listThreadIds(labelId, limit) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await get<{ threads?: { id: string }[]; nextPageToken?: string }>("/threads", {
          labelIds: labelId,
          maxResults: String(Math.min(500, Math.max(1, limit - ids.length))),
          ...(pageToken ? { pageToken } : {}),
        });
        ids.push(...(page.threads ?? []).map((thread) => thread.id));
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < limit);
      return ids.slice(0, limit);
    },
    getThread(threadId) {
      return get<GmailThread>(`/threads/${encodeURIComponent(threadId)}`, { format: "full" });
    },
    async getAttachment(messageId, attachmentId) {
      const { data } = await get<{ data?: string }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      return new Uint8Array(Buffer.from(data ?? "", "base64url"));
    },
  };
}
