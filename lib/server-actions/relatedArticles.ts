"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { rankRelatedArticles, type RelatedPage, type RelatedSection, type RelatedSignals } from "@/lib/living-page/relatedArticles";
import { toActionResult } from "./result";
import { articleBacklinks } from "@/lib/living-page/articleBacklinks";

export async function readRelatedArticles(pageId: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(pageId);
    const snapshot = await supabaseRpc(getAdminSupabase()).call<RelatedSignals & {
      pages: RelatedPage[]; sections: RelatedSection[]; text: string;
      entities: Parameters<typeof articleBacklinks>[1];
      articleTexts: { id: string; text: string }[];
    }>("related_article_signals", { p_page_id: pageId });
    const backlinks = articleBacklinks(snapshot.pages, snapshot.entities, snapshot.sections as Parameters<typeof articleBacklinks>[2], snapshot.articleTexts, pageId);
    return { articles: rankRelatedArticles(snapshot.pages, snapshot.sections, pageId, snapshot.text, {
      ...snapshot, connections: [...snapshot.connections, ...backlinks],
    }) };
  });
}
