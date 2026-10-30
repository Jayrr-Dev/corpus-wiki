import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inspect } from "node:util";
import { componentFromStack } from "./componentFromStack";
import { ACTION_FAILED } from "@/lib/server-actions/result";
import { currentActor } from "@/lib/auth/currentPerson";

// =====================================================================
// ERROR LOG (server): writes one row to public.error_log per error, so
// /errors lists everything that went wrong. Never throws and never logs
// through the patched console, so a broken log can't loop or fail a request.
// See supabase/migrations/20261108000000_error_log.sql.
// =====================================================================

export type ErrorSource = "server" | "action" | "console" | "client" | "ai";
export type ErrorLevel = "error" | "warning";
export type ErrorEntry = {
  level?: ErrorLevel;
  source: ErrorSource;
  location?: string | null;
  path?: string | null;
  // the component it happened in; read from the stack when not given
  component?: string | null;
  componentStack?: string | null;
  message: string;
  stack?: string | null;
  digest?: string | null;
};

// The console as it was before captureConsole patched it
const original = { error: console.error.bind(console), warn: console.warn.bind(console) };

// Its own client: the shared admin client names the signed-in person on every call by
// reading the request's cookies, which can hang outside a request (see lib/auth/currentPerson.ts)
let client: SupabaseClient | null | undefined;
function logClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  client = url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const actor = await currentActor();
      const headers = new Headers(init?.headers);
      if (actor.personId) headers.set("x-person-id", actor.personId);
      if (actor.spaceId) headers.set("x-space-id", actor.spaceId);
      return fetch(input, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    } } })
    : null;
  return client;
}

// The same message twice within this window is one error (Next logs what onRequestError already reported)
const REPEAT_WINDOW_MS = 5_000;
const recent = new Map<string, number>();
function isRepeat(message: string): boolean {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > REPEAT_WINDOW_MS) recent.delete(key);
  if (recent.has(message)) return true;
  recent.set(message, now);
  return false;
}

// Writes one error; resolves even when the write fails
export async function logError(entry: ErrorEntry): Promise<void> {
  const message = entry.message.trim() || "Unknown error";
  if (isRepeat(message)) return;
  const db = logClient();
  if (!db) return;
  try {
    const { componentStack, ...fields } = entry;
    const component = entry.component ?? componentFromStack(componentStack, entry.stack);
    const { error } = await db.rpc("log_error", { p_error: { ...fields, component, level: entry.level ?? "error", message } });
    if (error) original.error("Could not write to the error log:", error.message);
  } catch (error) {
    original.error("Could not write to the error log:", error instanceof Error ? error.message : error);
  }
}

// The message and stack of a thrown value
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack ?? null };
  return { message: typeof error === "string" ? error : inspect(error, { depth: 3 }), stack: null };
}

// CONSOLE CAPTURE: every console.error / console.warn on the server also lands in the log.
// Background jobs (upload workflow, glossary, web fill) report their failures this way.
let captured = false;
export function captureConsole(): void {
  if (captured) return;
  captured = true;
  const capture = (level: ErrorLevel) => (...args: unknown[]) => {
    (level === "error" ? original.error : original.warn)(...args);
    const thrown = args.find((arg) => arg instanceof Error);
    if (args[0] === ACTION_FAILED) {
      void logError({ source: "action", ...describeError(args[1]) });
      return;
    }
    const message = args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : inspect(arg, { depth: 3 }))).join(" ");
    // Node's notice about its own experimental features, once per worker: not an error of ours
    if (message.includes("ExperimentalWarning")) return;
    void logError({ level, source: "console", message, stack: thrown instanceof Error ? (thrown.stack ?? null) : null });
  };
  console.error = capture("error");
  console.warn = capture("warning");
}
