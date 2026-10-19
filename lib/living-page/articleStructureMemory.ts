import "server-only";
import type { DbRpc } from "@/lib/db/rpc";
import { workflowWrite } from "@/lib/ingest/workflowContext";

export type ArticleStructureSection = { sectionId?: string | null; title: string; position: number; unitIds: string[]; protected?: boolean };
export type SavedArticleStructure = { id: string; status: "planned" | "applied"; structure: ArticleStructureSection[]; rationale: string; outOfDate?: boolean };
export type ArticleStructureMemory = { current: ArticleStructureSection[]; planned: SavedArticleStructure | null; applied: SavedArticleStructure | null };

export async function readArticleStructure(db: DbRpc, pageId: string): Promise<ArticleStructureMemory> {
  return db.call<ArticleStructureMemory>("read_article_structure", { p_page_id: pageId });
}
export async function saveArticleStructure(db: DbRpc, input: { pageId: string; key: string; structure: ArticleStructureSection[]; changes: unknown; rationale: string; model: string | null }): Promise<string> {
  return workflowWrite<string>(db, `article-structure:${input.pageId}:${input.key}:save`, "save_article_structure_plan", {
    p_page_id: input.pageId, p_plan_key: input.key, p_structure: input.structure, p_changes: input.changes, p_rationale: input.rationale, p_model_version: input.model,
  });
}
export async function finishArticleStructure(db: DbRpc, id: string, status: "applied" | "failed", structure?: ArticleStructureSection[]): Promise<void> {
  await workflowWrite(db, `article-structure:${id}:${status}`, "finish_article_structure_plan", { p_plan_id: id, p_status: status, p_structure: structure ?? null });
}
