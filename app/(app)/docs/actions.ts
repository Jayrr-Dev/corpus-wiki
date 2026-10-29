"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { docSetsToRetire, planDocCleanup } from "@/lib/docs/clean";
import { adminDb, listDocSets } from "@/lib/docs/server";
import { readEnabledModules } from "@/lib/modules";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";

const docSetId = z.uuid();
const docTitle = z.string().trim().min(1, "Give the doc a name.").max(200, "Keep the name under 200 characters.");

// Admin actions on one doc: the same sign-in and Docs-on check as Clean
async function requireDocsOn(): Promise<void> {
  await requireUser();
  if (!(await readEnabledModules()).includes("docs")) throw new Error("Docs is off. Turn it on in Settings → Features.");
}

// RENAME: sets a doc's title, shown in the Docs list and the reader
export async function renameDocSet(id: string, title: string): Promise<ActionResult<{ id: string; title: string }>> {
  return toActionResult(async () => {
    await requireDocsOn();
    const docId = docSetId.safeParse(id);
    const name = docTitle.safeParse(title);
    if (!docId.success) throw new Error("Choose a doc.");
    if (!name.success) throw new Error(name.error.issues[0]?.message ?? "Give the doc a name.");
    const renamed = await adminDb().call<number>("rename_doc_set", { p_doc_set_id: docId.data, p_title: name.data });
    if (!renamed) throw new Error("This doc is gone. Reload the page.");
    revalidatePath("/docs");
    revalidatePath(`/docs/${docId.data}`);
    return { id: docId.data, title: name.data };
  });
}

// DELETE: hides one doc and its pages, the same soft delete Clean uses (retired_at). Nothing is erased.
// A doc still being written cannot be retired yet (retire_doc_sets skips it).
export async function deleteDocSet(id: string): Promise<ActionResult<{ hidden: number }>> {
  return toActionResult(async () => {
    await requireDocsOn();
    const docId = docSetId.safeParse(id);
    if (!docId.success) throw new Error("Choose a doc.");
    const hidden = await adminDb().call<number>("retire_doc_sets", { p_doc_set_ids: [docId.data] });
    if (!hidden) throw new Error("This doc is still being written, or it is already gone. Try again when it is done.");
    revalidatePath("/docs");
    revalidatePath(`/docs/${docId.data}`);
    return { hidden };
  });
}

// CLEAN: retires duplicate doc sets (lib/docs/clean.ts). Only the sets the person confirmed
// are retired, and only while the current list still marks them as duplicates.
export async function cleanDocSets(confirmed: string[]): Promise<ActionResult<{ retired: number }>> {
  return toActionResult(async () => {
    await requireUser();
    if (!(await readEnabledModules()).includes("docs")) throw new Error("Docs is off. Turn it on in Settings → Features.");
    const asked = new Set(z.array(z.uuid()).max(500).parse(confirmed));
    const db = adminDb();
    const ids = docSetsToRetire(planDocCleanup(await listDocSets(db))).filter((id) => asked.has(id));
    const retired = ids.length ? await db.call<number>("retire_doc_sets", { p_doc_set_ids: ids }) : 0;
    revalidatePath("/docs");
    return { retired };
  });
}
