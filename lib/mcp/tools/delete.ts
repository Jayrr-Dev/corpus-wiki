import { z } from "zod";
import { setAssetDeleted } from "@/lib/server-actions/assets";
import { deleteDomainAction, deleteEntityAction } from "@/lib/server-actions/catalog";
import { deletePage, removeLine, removeSection } from "@/lib/server-actions/pages";
import type { ActionResult } from "@/lib/server-actions/result";
import { removeSource } from "@/lib/server-actions/sources";
import { getServerSupabase } from "@/lib/supabase/server";
import { defineTool, type AgentToolDef } from "../types";

// =====================================================================
// DELETE TOOLS (scope `delete`). Articles, sections and lines are
// retired through Change control (undo_change_set brings them back);
// an asset goes to the Assets trash (restore_asset). Sources, and
// entities or domains that are already retired, are removed for good,
// as from their screens. Nothing the app only archives is ever purged:
// purgeSourceAction and permanentlyDeleteAsset stay with the person.
// =====================================================================

const id = z.uuid();
const ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

// A refused server action becomes a thrown Error (the same rule as write.ts, kept here so
// this file does not load every write action)
async function unwrap<T extends object>(pending: Promise<ActionResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new Error(result.error);
  const { ok, ...rest } = result;
  void ok;
  return rest as T;
}

// The line's current revision, so a line edited meanwhile is not removed by mistake
async function currentLineRevision(lineId: string): Promise<string> {
  const { data, error } = await (await getServerSupabase()).from("lines").select("current_revision_id").eq("id", lineId).is("retired_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That line is not in this Space, or was already removed.");
  return data.current_revision_id;
}

export const deleteTools: AgentToolDef[] = [
  defineTool({
    name: "delete_article",
    title: "Delete an article",
    description: "Remove an article. It is retired, not erased: the change is listed under Changes and undo_change_set brings it back. The knowledge it showed stays.",
    scope: "delete",
    input: z.object({ pageId: id }),
    annotations: ANNOTATIONS,
    run: async ({ pageId }) => {
      await unwrap(deletePage(pageId));
      return { pageId, removed: true, undo: "undo_change_set on the change listed under Changes", href: "/changes" };
    },
  }),
  defineTool({
    name: "remove_section",
    title: "Remove a section",
    description: "Remove one section from an article. It is retired, not erased: undo_change_set brings it back. The knowledge it showed stays.",
    scope: "delete",
    input: z.object({ sectionId: id }),
    annotations: ANNOTATIONS,
    run: async ({ sectionId }) => {
      await unwrap(removeSection(sectionId));
      return { sectionId, removed: true, undo: "undo_change_set on the change listed under Changes", href: "/changes" };
    },
  }),
  defineTool({
    name: "remove_line",
    title: "Remove a line",
    description: "Remove one line from an article. It is retired, not erased: undo_change_set brings it back. Pass lineRevisionId to refuse if the line changed since you read it.",
    scope: "delete",
    input: z.object({ lineId: id, lineRevisionId: id.optional().describe("The line revision you read. Defaults to its current one.") }),
    annotations: ANNOTATIONS,
    run: async ({ lineId, lineRevisionId }) => {
      await unwrap(removeLine(lineId, lineRevisionId ?? (await currentLineRevision(lineId))));
      return { lineId, removed: true, undo: "undo_change_set on the change listed under Changes", href: "/changes" };
    },
  }),
  defineTool({
    name: "remove_source",
    title: "Delete a source",
    description: "Permanently delete a source: its record, its passages and its stored file. This cannot be undone. Knowledge that cited it stays, marked as having lost its source. To keep the file, use archive_source instead.",
    scope: "delete",
    input: z.object({ sourceId: id }),
    annotations: ANNOTATIONS,
    run: async ({ sourceId }) => ({ sourceId, ...(await unwrap(removeSource(sourceId))), href: "/sources" }),
  }),
  defineTool({
    name: "delete_entity",
    title: "Delete a retired entity",
    description: "Permanently delete an entity that is already retired; a current one is refused. Its links to claims, articles and domains are dropped. This cannot be undone, and undoing its earlier retire then fails.",
    scope: "delete",
    input: z.object({ entityId: id }),
    annotations: ANNOTATIONS,
    run: async ({ entityId }) => ({ entityId, ...(await unwrap(deleteEntityAction(entityId))), href: "/entities" }),
  }),
  defineTool({
    name: "delete_domain",
    title: "Delete a retired domain",
    description: "Permanently delete a retired domain and its retired subtree; refused while it or any domain under it is current. Claims, articles and exceptions lose the link. This cannot be undone.",
    scope: "delete",
    input: z.object({ domainId: id }),
    annotations: ANNOTATIONS,
    run: async ({ domainId }) => ({ domainId, ...(await unwrap(deleteDomainAction(domainId))), href: "/domains" }),
  }),
  defineTool({
    name: "delete_asset",
    title: "Delete an asset",
    description: "Move an asset (image or video) to the Assets trash. It can be brought back with restore_asset; only a person can empty the trash.",
    scope: "delete",
    input: z.object({ assetId: id }),
    annotations: { ...ANNOTATIONS, idempotentHint: true },
    run: async ({ assetId }) => {
      await unwrap(setAssetDeleted(assetId, true));
      return { assetId, deleted: true, undo: "restore_asset", href: "/assets" };
    },
  }),
];
