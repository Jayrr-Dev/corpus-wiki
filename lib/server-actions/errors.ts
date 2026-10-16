"use server";

import { revalidatePath } from "next/cache";
import { logError } from "@/lib/errors/errorLog";
import { getServerSupabase } from "@/lib/supabase/server";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// CLIENT ERROR REPORT: error boundaries and the browser's own error
// events send what went wrong here; it is written to the error log
// (/errors) and the server terminal.
// =====================================================================

export type ClientErrorReport = { where: string; message: string; digest?: string; path?: string; stack?: string };

// The longest message and stack kept from the browser
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;

// Writes one browser error to the log
export async function reportClientError(report: ClientErrorReport): Promise<void> {
  const message = String(report.message).slice(0, MAX_MESSAGE_LENGTH);
  process.stdout.write(`[client error] ${report.where}${report.path ? ` at ${report.path}` : ""}: ${message}${report.digest ? ` (digest ${report.digest})` : ""}\n`);
  await logError({
    source: "client",
    location: String(report.where).slice(0, 200),
    path: report.path ?? null,
    message,
    stack: report.stack ? String(report.stack).slice(0, MAX_STACK_LENGTH) : null,
    digest: report.digest ?? null,
  });
}

// CLEAR THE LOG: removes every row (as the signed-in person, under RLS)
export async function clearErrorLog(): Promise<ActionResult> {
  return toActionResult(async () => {
    const db = await getServerSupabase();
    const { error } = await db.from("error_log").delete().gte("created_at", "1970-01-01");
    if (error) throw new Error(error.message);
    revalidatePath("/errors");
    return {};
  });
}
