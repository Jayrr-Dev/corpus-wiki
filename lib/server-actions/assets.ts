"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { describeAssets as describe, tagVocabulary } from "@/lib/assets/describe";
import { ASSET_TYPES, isTypeWord, normalizeTag } from "@/lib/assets/tags";
import { toActionResult } from "./result";

const ASSETS_PER_CALL = 16;

// ASSETS (called by /assets): find new media in the sources, then have the Media analyst
// describe and tag them, a few batches per call (the screen calls again while some remain).
// `ids` describes just those assets again.
export async function describeAssets(options: { ids?: string[] } = {}) {
  return toActionResult(async () => {
    await requireUser();
    const ids = options.ids ? z.array(z.string().uuid()).max(200).parse(options.ids) : undefined;
    const client = getAdminSupabase();
    const db = supabaseRpc(client);
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "media_analyst" } }));
    if (!settings) throw new Error("Configure the AI provider in Settings to describe assets.");
    return describe(client, settings, ids ? { ids } : { limit: ASSETS_PER_CALL });
  });
}

const editSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional(),
  asset_type: z.enum(ASSET_TYPES).optional(),
  tags: z.array(z.string().max(200)).max(50).optional(),
});

// A PERSON'S EDIT (called by /assets/[id]): sets the fields given and marks them edited, so
// "Describe again" leaves them alone. Tags go through the same vocabulary as the analyst's.
export async function editAsset(id: string, edit: z.input<typeof editSchema>) {
  return toActionResult(async () => {
    await requireUser();
    const assetId = z.string().uuid().parse(id);
    const values = editSchema.parse(edit);
    const client = getAdminSupabase();
    const current = await client.from("assets").select("edited_fields").eq("id", assetId).single();
    if (current.error) throw new Error(current.error.message);
    const tags = values.tags ? (await tagVocabulary(client)).clean(values.tags, { learn: false }) : undefined;
    const fields = (Object.keys(values) as (keyof typeof values)[]).filter((field) => values[field] !== undefined);
    const { error } = await client.from("assets").update({
      ...values,
      ...(values.description !== undefined ? { description: values.description || null } : {}),
      ...(tags ? { tags } : {}),
      edited_fields: [...new Set([...current.data.edited_fields, ...fields])],
    }).eq("id", assetId);
    if (error) throw new Error(error.message);
    return { tags: tags ?? null };
  });
}

// HAND BACK TO THE ANALYST (called by /assets/[id]): forgets which fields a person edited,
// so the next "Describe again" rewrites them all
export async function releaseAssetEdits(id: string) {
  return toActionResult(async () => {
    await requireUser();
    const { error } = await getAdminSupabase().from("assets").update({ edited_fields: [] }).eq("id", z.string().uuid().parse(id));
    if (error) throw new Error(error.message);
    return {};
  });
}

// RENAME OR MERGE A TAG (called by /assets): rewrites it on every asset; when the new name is
// already a tag the two become one. The old name is remembered so the analyst's later passes follow.
export async function renameAssetTag(from: string, to: string) {
  return toActionResult(async () => {
    await requireUser();
    const oldName = z.string().min(1).max(200).parse(from);
    const newName = normalizeTag(z.string().max(200).parse(to));
    if (!newName) throw new Error("Give the tag a name.");
    if (isTypeWord(newName)) throw new Error(`"${newName}" is a type of asset, not a tag; set it as the asset's type instead.`);
    const changed = await supabaseRpc(getAdminSupabase()).call<number>("rename_asset_tag", { p_from: oldName, p_to: newName });
    return { changed, tag: newName };
  });
}
