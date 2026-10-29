"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { docSetsToRetire, planDocCleanup } from "@/lib/docs/clean";
import { adminDb, listDocSets } from "@/lib/docs/server";
import { readEnabledModules } from "@/lib/modules";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";

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
