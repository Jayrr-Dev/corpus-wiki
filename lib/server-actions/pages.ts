"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { rebuildPage } from "@/lib/living-page";
import { getServerDeps } from "@/lib/server/deps";
import { type AdminSupabase, getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// PAGE ACTIONS (called by /). Pages are presentation, not knowledge, so
// they are written directly (no Change control). Deleting a page removes
// its sections, inputs and change notes (cascade); no unit is touched.
// =====================================================================

// CREATE: a page from a title; with an entity it gets a generated "Overview" section and is built
export async function createPage(input: { title: string; entityId: string | null }): Promise<ActionResult<{ pageId: string; slug: string }>> {
  return toActionResult(async () => {
    await requireUser();
    const title = cleanTitle(input.title);
    const admin = getAdminSupabase();
    const slug = await uniqueSlug(admin, title);
    const { data: page, error } = await admin.from("pages").insert({ title, slug, entity_id: input.entityId }).select("id").single();
    if (error) throw new Error(error.message);
    if (input.entityId) {
      // No half-made page: if the section cannot be added, the page goes too
      await addOverviewSection(admin, page.id, input.entityId).catch(async (sectionError: unknown) => {
        await admin.from("pages").delete().eq("id", page.id);
        throw sectionError;
      });
      const { db, writer } = await getServerDeps();
      await rebuildPage(db, writer, page.id);
    }
    return { pageId: page.id, slug };
  });
}

// RENAME: changes the title only; the slug stays so links keep working
export async function renamePage(pageId: string, title: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { error } = await getAdminSupabase().from("pages").update({ title: cleanTitle(title) }).eq("id", pageId);
    if (error) throw new Error(error.message);
    return {};
  });
}

// DELETE: removes the page; its sections go with it (on delete cascade)
export async function deletePage(pageId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { error } = await getAdminSupabase().from("pages").delete().eq("id", pageId);
    if (error) throw new Error(error.message);
    return {};
  });
}

// Trimmed title; an empty one is refused
function cleanTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Give the page a title.");
  return trimmed;
}

// "Project Alpha!" -> "project-alpha"
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

// The title's slug, with -2, -3… when it is taken
async function uniqueSlug(admin: AdminSupabase, title: string): Promise<string> {
  const base = slugify(title);
  const { data, error } = await admin.from("pages").select("slug").like("slug", `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set((data ?? []).map((row) => row.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

// The generated "Overview" section bound to the entity (rebuildPage writes its body)
async function addOverviewSection(admin: AdminSupabase, pageId: string, entityId: string): Promise<void> {
  const { data: entity, error } = await admin.from("entities").select("type, key").eq("id", entityId).single();
  if (error) throw new Error(error.message);
  const query = { entity: { type: entity.type, key: entity.key } };
  const insert = await admin.from("sections").insert({ page_id: pageId, position: 0, title: "Overview", mode: "generated", query, status: "stale" });
  if (insert.error) throw new Error(insert.error.message);
}
