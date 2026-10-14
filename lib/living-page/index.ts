import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import { composeBody } from "./sentences";
import type { SavedSectionBuild, SectionBuild, SectionRef, SectionUnitsRead, SectionWriteInput, WrittenSection } from "./types";
import { FakeSectionWriter } from "./writers/fake";
import { TokenFactorySectionWriter } from "./writers/tokenFactory";

export type * from "./types";
export { composeBody, splitBody } from "./sentences";
export { FakeSectionWriter } from "./writers/fake";
export { TokenFactorySectionWriter } from "./writers/tokenFactory";

// =====================================================================
// LIVING PAGE: rebuilds page sections after each commit. The database
// picks the sections and the units (lib/living-page SQL functions); the
// writer turns units into cited sentences; the build is saved with its
// inputs, so the next event knows which sections used which units.
// =====================================================================

// Writes a section's prose from its units (fake without a key, Nemotron with one)
export interface SectionWriter {
  readonly name: string;
  writeSection(input: SectionWriteInput): Promise<WrittenSection>;
}

// Picks the writer from server env: Token Factory when NEBIUS_API_KEY is set, else the fake
export function getSectionWriter(env: NodeJS.ProcessEnv = process.env): SectionWriter {
  const settings = tokenFactoryFromEnv(env);
  return settings ? new TokenFactorySectionWriter(settings) : new FakeSectionWriter();
}

// Rebuilds every section whose units the event changed, with a change note each
export async function rebuildAfterEvent(db: DbRpc, writer: SectionWriter, eventId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_affected_sections", { p_event_id: eventId });
  for (const section of sections) await rebuildSection(db, writer, section.sectionId, eventId);
}

// Builds every generated section of one page (used after a page is created); no change notes
export async function rebuildPage(db: DbRpc, writer: SectionWriter, pageId: string): Promise<void> {
  const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  for (const section of sections) await rebuildSection(db, writer, section.sectionId, null);
}

// One section: mark building, read its units, write, save (with a note when an event caused it)
export async function rebuildSection(
  db: DbRpc,
  writer: SectionWriter,
  sectionId: string,
  eventId: string | null,
): Promise<SavedSectionBuild> {
  await db.call("mark_section_building", { p_section_id: sectionId });
  const read = await db.call<SectionUnitsRead>("read_section_units", { p_section_id: sectionId });
  const build = await buildSection(writer, read);
  return db.call<SavedSectionBuild>("save_section_build", { p_section_id: sectionId, p_event_id: eventId, p_build: build });
}

// Turns the section's units into a saved build; no units means an empty body and no model call
async function buildSection(writer: SectionWriter, read: SectionUnitsRead): Promise<SectionBuild> {
  const inputs = read.units.map(({ unitId, revisionId }) => ({ unitId, revisionId }));
  if (read.units.length === 0) return { body: "", sentenceLinks: [], modelVersion: writer.name, inputs };
  const written = await writer.writeSection({ pageTitle: read.pageTitle, sectionTitle: read.title, units: read.units });
  return { ...composeBody(written.sentences), modelVersion: written.modelVersion, inputs };
}
