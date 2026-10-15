"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { type DeleteRetiredResult, deleteRetiredDomain, deleteRetiredEntity } from "@/lib/knowledge/deleteRetired";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// CATALOG DELETES (the "…" menu of a retired domain or entity): remove
// it for good. Retire stays the undoable path; this cannot be undone.
// =====================================================================

// DOMAIN: a retired domain and its subtree
export async function deleteDomainAction(domainId: string): Promise<ActionResult<DeleteRetiredResult>> {
  return toActionResult(async () => {
    await requireUser();
    return deleteRetiredDomain(domainId);
  });
}

// ENTITY: a retired entity
export async function deleteEntityAction(entityId: string): Promise<ActionResult<DeleteRetiredResult>> {
  return toActionResult(async () => {
    await requireUser();
    return deleteRetiredEntity(entityId);
  });
}
