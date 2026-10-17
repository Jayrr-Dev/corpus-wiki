"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import type { ArticleLink } from "@/lib/living-page/articleEvidence";
import { toActionResult } from "./result";

export async function readArticleTopicLinks(pageId: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(pageId);
    const links = await supabaseRpc(getAdminSupabase()).call<ArticleLink[]>("article_topic_links", { p_page_id: pageId });
    return { links };
  });
}
