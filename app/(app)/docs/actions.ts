"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { docSetsToRetire, planDocCleanup } from "@/lib/docs/clean";
import { adminDb, listDocSets, renameDocSetTitle } from "@/lib/docs/server";
import { readEnabledModules } from "@/lib/modules";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";

const requireDocsOn = async () => {
  if (!(await readEnabledModules()).includes("docs")) throw new Error("Docs is off. Turn it on in Settings → Features.");
};

// CLEAN: retires duplicate doc sets (lib/docs/clean.ts). Only the sets the person confirmed
// are retired, and only while the current list still marks them as duplicates.
export async function cleanDocSets(confirmed: string[]): Promise<ActionResult<{ retired: number }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireDocsOn();
    const asked = new Set(z.array(z.uuid()).max(500).parse(confirmed));
    const db = adminDb();
    const ids = docSetsToRetire(planDocCleanup(await listDocSets(db))).filter((id) => asked.has(id));
    const retired = ids.length ? await db.call<number>("retire_doc_sets", { p_doc_set_ids: ids }) : 0;
    revalidatePath("/docs");
    return { retired };
  });
}

// RENAME: a doc set's title, as the Docs list and the reader show it
export async function renameDocSet(id: string, title: string): Promise<ActionResult<{ title: string }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireDocsOn();
    const docSetId = z.uuid().parse(id);
    const name = z.string().trim().min(1, "Give the doc a name.").max(200, "Use 200 characters or fewer.").parse(title);
    const { spaceId } = await currentActor();
    if (!spaceId) throw new Error("Choose a space first.");
    if (!(await renameDocSetTitle(docSetId, spaceId, name))) throw new Error("That doc no longer exists.");
    revalidatePath("/docs");
    revalidatePath(`/docs/${docSetId}`);
    return { title: name };
  });
}

// DELETE: hides one doc set and its pages with the same retire that Clean uses (soft delete,
// see supabase/migrations/20261121040000_doc_set_cleanup.sql). Nothing is erased. The database
// refuses a set that is still being written, and then it returns 0.
export async function deleteDocSet(id: string): Promise<ActionResult<{ deleted: number }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireDocsOn();
    const docSetId = z.uuid().parse(id);
    const deleted = await adminDb().call<number>("retire_doc_sets", { p_doc_set_ids: [docSetId] });
    if (!deleted) throw new Error("This doc is still being written, or it is already gone. Try again when it is done.");
    revalidatePath("/docs");
    return { deleted };
  });
}
