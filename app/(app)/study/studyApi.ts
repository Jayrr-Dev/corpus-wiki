import type { Coverage, Scope } from "@/lib/knowledge/scopeTypes";
import type { AnswerOutcome, StudyKind } from "@/lib/study/types";

// =====================================================================
// STUDY API FROM THE BROWSER: thin calls to /api/study. Each throws the
// server's message, so the screens can show it as is.
// =====================================================================

async function readError(response: Response): Promise<string> {
  if (response.status === 401) return "Sign in to study.";
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "Something went wrong. Try again.";
}

async function post<T>(url: string, body?: object, method = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export type NewSet = { title: string; scope: Scope; coverage: Coverage; types: StudyKind[] };

// NEW SET: streams the question count while the Tutor writes; resolves with the new set's id
export async function createSet(input: NewSet, onProgress: (done: number, total: number) => void): Promise<string> {
  const response = await fetch("/api/study/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok || !response.body) throw new Error(await readError(response));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (done && buffer) lines.push(buffer);
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as { type: string; done?: number; total?: number; id?: string; error?: string };
        if (event.type === "progress") onProgress(event.done ?? 0, event.total ?? 0);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result" && event.id) return event.id;
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  throw new Error("The connection ended before the set was ready. Check the list before trying again.");
}

export type Answer = { itemId: string; result?: "right" | "wrong"; response?: string; timeZone?: string };
export const answer = (input: Answer) => post<AnswerOutcome>("/api/study/answer", input);
export const regenerate = (itemId: string) => post<{ ok: true }>(`/api/study/items/${itemId}/regenerate`);
export const removeQuestion = (itemId: string) => post<{ ok: true }>(`/api/study/items/${itemId}`, undefined, "DELETE");
export const rebuildStale = (setId: string) => post<{ rebuilt: number; retired: number }>(`/api/study/sets/${setId}/rebuild`);
