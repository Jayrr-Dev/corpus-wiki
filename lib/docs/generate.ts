import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { DOCS_WRITER_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import type { DbRpc } from "@/lib/db/rpc";
import { rebuildPage, type SectionWriter } from "@/lib/living-page";
import { type DocOutline, fallbackOutline, MAX_OUTLINE_PAGES, MAX_PAGE_SECTIONS, normalizeOutline, outlineAnswerSchema } from "./outline";

// =====================================================================
// DOCS GENERATION: the Docs writer proposes an outline from a scope's
// claims (purpose "docs_outline"); after a person approves it, the set's
// pages are created and each is written through the living page
// (rebuildPage), where the Docs section style turns claims into blocks.
// =====================================================================

// The claims an outline is planned from (the scope's, after coverage)
export type OutlineClaim = { unitId: string; title: string | null; content: string };

export type OutlineModel = (request: { system: string; user: string }) => Promise<{ value: z.infer<typeof outlineAnswerSchema> }>;

export function chatOutlineModel(settings: TokenFactorySettings): OutlineModel {
  return (request) => chatJson(settings, {
    name: "docs_outline",
    schema: outlineAnswerSchema,
    jsonSchema: z.toJSONSchema(outlineAnswerSchema),
    maxTokens: 8_000,
    messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
  });
}

const OUTLINE_RULES = `Plan the pages of a doc set before any page is written. Group pages by task: set_up (create, install, connect), use (everyday tasks), change (modify, resize, update) and remove (delete, clean up).
Each page has a short title in the docs' imperative style (for example "Creating a cluster" or "Managing backups"), introUnitIds (one or two claims that say what the subject is) and tasks: sections with a short title and the unitIds of the claims each task is written from.
Order pages, and the tasks within a page, in the order a reader does them: when the claims give a sequence (step numbers, "before", "after", "then"), follow it.
Use only the supplied unitIds, each at most once. Leave out claims that describe no task or subject. At most ${MAX_OUTLINE_PAGES} pages and ${MAX_PAGE_SECTIONS} tasks per page. Also give the set a short title.`;

// Asks the Docs writer for an outline (or builds a plain one without AI), always normalized
export async function proposeOutline(model: OutlineModel | null, title: string, claims: readonly OutlineClaim[]): Promise<DocOutline> {
  const unitIds = claims.map((claim) => claim.unitId);
  if (!model || !claims.length) return fallbackOutline(title, unitIds);
  const user = JSON.stringify({ scope: title, claims: claims.map((claim) => ({ unitId: claim.unitId, ...(claim.title ? { title: claim.title } : {}), content: claim.content.slice(0, 600) })) });
  const answer = await model({ system: `${DOCS_WRITER_INSTRUCTIONS}\n${OUTLINE_RULES}`, user });
  const outline = normalizeOutline(answer.value, unitIds, title);
  return outline.pages.length ? outline : fallbackOutline(title, unitIds);
}

// Writes every page of a new or rebuilt set, then records how it went. Pages are written one at a
// time; a failed page leaves its sections stale (the reader offers Rebuild page) and the set failed.
export async function writeDocPages(db: DbRpc, writer: SectionWriter, docSetId: string, pageIds: readonly string[]): Promise<void> {
  await db.call("set_doc_set_status", { p_doc_set_id: docSetId, p_status: "writing" });
  const failures: string[] = [];
  for (const pageId of pageIds) {
    try { await rebuildPage(db, writer, pageId); }
    catch (error) {
      console.error("Doc page build failed", { docSetId, pageId, error });
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) {
    const error = `${failures.length} page${failures.length === 1 ? "" : "s"} could not be written: ${failures[0]}`;
    await db.call("set_doc_set_status", { p_doc_set_id: docSetId, p_status: "failed", p_error: error.slice(0, 500) });
  } else {
    await db.call("set_doc_set_status", { p_doc_set_id: docSetId, p_status: "ready" });
  }
}
