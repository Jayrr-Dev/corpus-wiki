"use server";

// =====================================================================
// CLIENT ERROR REPORT: error boundaries send what crashed in the browser
// here, so it lands in the server log next to server-side errors.
// Logging only; nothing is stored or returned.
// =====================================================================

export type ClientErrorReport = { where: string; message: string; digest?: string; path?: string };

// The longest message kept (a boundary report is a hint, not a dump)
const MAX_MESSAGE_LENGTH = 1000;

// Writes one line to the server log
export async function reportClientError(report: ClientErrorReport): Promise<void> {
  const message = String(report.message).slice(0, MAX_MESSAGE_LENGTH);
  console.error(`[client error] ${report.where}${report.path ? ` at ${report.path}` : ""}: ${message}${report.digest ? ` (digest ${report.digest})` : ""}`);
}
