import "server-only";
import type { DbRpc } from "@/lib/db/rpc";
import type { TokenFactorySettings } from "@/lib/ai/chat";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { articleAdditionActions } from "@/lib/living-page/articleScaffold";
import { commitPersonEdit } from "@/lib/change-control";
import { discoverArticleUpdates } from "@/lib/living-page/discoverArticleUpdates";
import { rebuildSection, type SectionWriter } from "@/lib/living-page";

export async function expandSourcedArticle(deps: { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings; writer: SectionWriter }, pageId: string, unitIds: string[], note: string, sectionTitle?: string) {
  if (!unitIds.length) return 0;
  const planned = await discoverArticleUpdates(deps.db, deps.client, deps.settings, pageId,
    `Expand this article with the newly sourced knowledge, using relevant facts with citations. Preserve existing content and avoid duplication.${sectionTitle ? ` Keep additions focused on the section ${JSON.stringify(sectionTitle)}.` : ""} ${note}`, unitIds);
  if (!planned.sections.length) return 0;
  const actions = await articleAdditionActions(deps.db, deps.client, deps.settings, pageId, planned.sections, note);
  if (!actions.length) return 0;
  const committed = await commitPersonEdit(deps.db, "Expanded article with user-requested external information", actions);
  if (committed.status !== "applied") throw new Error("Sources were saved, but article expansion could not be applied. Review Changes.");
  const { data, error } = await deps.client.from("actions").select("target_id").eq("change_set_id", committed.changeSetId).eq("type", "create_section");
  if (error) throw new Error(error.message);
  const sections = (data ?? []).flatMap((action) => action.target_id ? [action.target_id] : []);
  for (const id of sections) {
    const built = await rebuildSection(deps.db, deps.writer, id, null, false);
    if (!built) throw new Error("Sources and sections were saved, but article writing is still busy. Update the article to finish.");
  }
  await deps.writer.reviewSections?.(sections);
  return sections.length;
}
