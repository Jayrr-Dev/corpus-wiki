"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";
import { publicationInput } from "@/lib/publishing/validation";
import type { PublishInput, WikiBody } from "@/lib/publishing/types";
import { loadPublicationEditor, loadWikiMetrics } from "@/lib/publishing/server";

export async function publishSpaceWiki(input: PublishInput) {
  return toActionResult(async () => {
    await requireUser();
    const validated = publicationInput.safeParse(input);
    if (!validated.success) throw new Error(validated.error.issues[0]?.message ?? "Check the publication details.");
    const v = validated.data;
    const publication = await supabaseRpc(getAdminSupabase()).call<{ slug: string | null; visibility: string }>("publish_space_wiki", {
      p_visibility: v.visibility, p_title: v.title, p_description: v.description, p_publisher: v.publisher, p_embed: v.embedEnabled, p_pages: v.pages,
    });
    revalidatePath("/explore");
    return { publication };
  });
}

export async function previewWikiPublication(pageId: string) {
  return toActionResult(async () => {
    await requireUser();
    if (!z.uuid().safeParse(pageId).success) throw new Error("Choose a valid page.");
    return supabaseRpc(getAdminSupabase()).call<{ body: WikiBody; fingerprint: string }>("preview_wiki_publication", { p_page: pageId });
  });
}

export async function loadPublishingDialog() {
  return toActionResult(async () => {
    const [editor, metrics] = await Promise.all([loadPublicationEditor(), loadWikiMetrics()]);
    return { editor, metrics };
  });
}

export async function getWikiMetrics(days: number) {
  return toActionResult(async () => {
    if (![7, 30, 90].includes(days)) throw new Error("Choose 7, 30 or 90 days.");
    return { metrics: await loadWikiMetrics(days) };
  });
}
