"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { sourceArticleInfo } from "@/lib/knowledge/sourceArticleInfo";
import { toActionResult } from "./result";

export async function addExternalInfo(pageId: string, note: string, sectionId?: string) {
  return toActionResult(async () => {
    await requireUser();
    return sourceArticleInfo(z.uuid().parse(pageId), z.string().trim().max(2000).parse(note), sectionId === undefined ? undefined : z.uuid().parse(sectionId));
  });
}
