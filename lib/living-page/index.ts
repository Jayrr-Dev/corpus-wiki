import type { DbRpc } from "@/lib/db/rpc";

// =====================================================================
// LIVING PAGE (agent D): rebuilds page sections after each commit.
// CONTRACT STUB: agent D replaces the bodies; the signatures stay.
// =====================================================================

// Writes a section's prose from its units (fake without a key, Nemotron with one)
export interface SectionWriter {
  readonly name: string;
}

// Picks the writer from server env (D implements): Token Factory when NEBIUS_API_KEY is set, else the fake
export function getSectionWriter(env: NodeJS.ProcessEnv = process.env): SectionWriter {
  void env;
  return { name: "stub" };
}

// Rebuilds every section whose units the event changed, with a change note each
export async function rebuildAfterEvent(db: DbRpc, writer: SectionWriter, eventId: string): Promise<void> {
  void db;
  void writer;
  void eventId;
}

// Builds every generated section of one page (used after a page is created)
export async function rebuildPage(db: DbRpc, writer: SectionWriter, pageId: string): Promise<void> {
  void db;
  void writer;
  void pageId;
}
