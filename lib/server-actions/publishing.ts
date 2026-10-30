"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";
import { publicationInput } from "@/lib/publishing/validation";
import type { PublishInput, WikiBody, WikiSource } from "@/lib/publishing/types";
import { loadPublicationEditor, loadWikiMetrics } from "@/lib/publishing/server";
import { loadThumbnailState, pickThumbnail, removeThumbnail, requireThumbnailState, saveAssetThumbnail, saveUploadedThumbnail } from "@/lib/publishing/thumbnailServer";
import { MAX_THUMBNAIL_UPLOAD_BYTES } from "@/lib/publishing/thumbnailImage";

// A first publish gets a thumbnail without being asked. A failure here costs a picture
// and never the publish; the Space shows its drawn cover until someone picks one.
async function pickThumbnailIfUndecided() {
  try {
    const state = await loadThumbnailState();
    if (state?.auto && !state.path) await pickThumbnail(await loadPublicationEditor(), state);
  } catch (caught) {
    console.error("Could not pick a thumbnail on publish:", caught);
  }
}

export async function publishSpaceWiki(input: PublishInput) {
  return toActionResult(async () => {
    await requireUser();
    const validated = publicationInput.safeParse(input);
    if (!validated.success) throw new Error(validated.error.issues[0]?.message ?? "Check the publication details.");
    const v = validated.data;
    const publication = await supabaseRpc(getAdminSupabase()).call<{ slug: string | null; visibility: string }>("publish_space_wiki", {
      p_visibility: v.visibility, p_title: v.title, p_description: v.description, p_publisher: v.publisher, p_embed: v.embedEnabled, p_pages: v.pages,
      // Sent only when asked for: a database without the setting still publishes as before
      ...(v.includeSources ? { p_sources: true } : {}),
    });
    // A person who chose a picture saves it straight after this, so don't spend a pick on it
    if (v.visibility !== "private" && !v.thumbnailChosen) await pickThumbnailIfUndecided();
    revalidatePath("/explore");
    return { publication };
  });
}

export async function uploadSpaceThumbnail(form: FormData) {
  return toActionResult(async () => {
    await requireUser();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose an image.");
    if (file.size > MAX_THUMBNAIL_UPLOAD_BYTES) throw new Error("That image is too large. Use one under 5 MB.");
    await saveUploadedThumbnail(file);
    revalidatePath("/explore");
    return {};
  });
}

export async function chooseSpaceThumbnail(assetId: string) {
  return toActionResult(async () => {
    await requireUser();
    await saveAssetThumbnail(z.uuid().parse(assetId));
    revalidatePath("/explore");
    return {};
  });
}

export async function autoPickSpaceThumbnail() {
  return toActionResult(async () => {
    await requireUser();
    const picked = await pickThumbnail(await loadPublicationEditor(), await requireThumbnailState());
    revalidatePath("/explore");
    return { picked };
  });
}

export async function removeSpaceThumbnail() {
  return toActionResult(async () => {
    await requireUser();
    await removeThumbnail();
    revalidatePath("/explore");
    return {};
  });
}

export async function previewWikiPublication(pageId: string) {
  return toActionResult(async () => {
    await requireUser();
    if (!z.uuid().safeParse(pageId).success) throw new Error("Choose a valid page.");
    return supabaseRpc(getAdminSupabase()).call<{ body: WikiBody; fingerprint: string; sources?: WikiSource[] }>("preview_wiki_publication", { p_page: pageId });
  });
}

export async function loadPublishingDialog() {
  return toActionResult(async () => {
    // The dialog still opens without thumbnails; the picker simply stays hidden
    const [editor, metrics, thumbnail] = await Promise.all([loadPublicationEditor(), loadWikiMetrics(), loadThumbnailState().catch((caught) => {
      console.error("Could not load the Space thumbnail:", caught);
      return null;
    })]);
    return { editor, metrics, thumbnail };
  });
}

export async function getWikiMetrics(days: number) {
  return toActionResult(async () => {
    if (![7, 30, 90].includes(days)) throw new Error("Choose 7, 30 or 90 days.");
    return { metrics: await loadWikiMetrics(days) };
  });
}
