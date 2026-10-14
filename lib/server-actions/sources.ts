"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { deleteSource, type DeleteSourceResult } from "@/lib/ingest/deleteSource";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// SOURCE ACTIONS (Sources "…" menu). Re-run lives with the upload
// actions (startRerun + processUpload); delete lives here.
// =====================================================================

// DELETE: retires knowledge only this file supports, then removes the source and its stored file
export async function removeSource(sourceId: string): Promise<ActionResult<DeleteSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return deleteSource(sourceId);
  });
}
