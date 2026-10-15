import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// DELETE RETIRED: removes a retired domain or entity for good. Only a
// retired one can go, so the usual path stays retire (undoable from
// Changes) and delete is the cleanup after it. Links to it are dropped
// first: units lose the tag, pages and exceptions keep going without it.
// The old change log still names it by id; undoing its retire then fails.
// =====================================================================

export type DeleteRetiredResult = { deleted: number };

// DOMAIN: it and its subtree (retire retires the subtree too); refused while any of them is current
export async function deleteRetiredDomain(domainId: string): Promise<DeleteRetiredResult> {
  const admin = getAdminSupabase();
  const { data: domains, error } = await admin.from("domains").select("id, parent_id, retired_at");
  if (error) throw new Error(error.message);
  const root = (domains ?? []).find((domain) => domain.id === domainId);
  if (!root) throw new Error("That domain no longer exists.");
  if (!root.retired_at) throw new Error("Only a retired domain can be deleted. Retire it first.");
  // Subtree, parents before children; deleted in reverse so no child outlives its parent
  const subtree = [root];
  for (const parent of subtree) subtree.push(...(domains ?? []).filter((domain) => domain.parent_id === parent.id));
  if (subtree.some((domain) => !domain.retired_at)) throw new Error("A domain under it is current again, so it cannot be deleted.");
  const ids = subtree.map((domain) => domain.id);
  await check(admin.from("unit_domains").delete().in("domain_id", ids), "unlink its units");
  await check(admin.from("exceptions").update({ domain_id: null }).in("domain_id", ids), "unlink its exceptions");
  await check(admin.from("pages").update({ domain_id: null }).in("domain_id", ids), "unlink its pages");
  for (const id of ids.reverse()) await check(admin.from("domains").delete().eq("id", id), "delete the domain");
  return { deleted: subtree.length };
}

// ENTITY: refused while it is current
export async function deleteRetiredEntity(entityId: string): Promise<DeleteRetiredResult> {
  const admin = getAdminSupabase();
  const { data: entity, error } = await admin.from("entities").select("id, retired_at").eq("id", entityId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!entity) throw new Error("That entity no longer exists.");
  if (!entity.retired_at) throw new Error("Only a retired entity can be deleted. Retire it first.");
  await check(admin.from("unit_entities").delete().eq("entity_id", entityId), "unlink its units");
  await dropHierarchyHistory(admin, entityId);
  await check(admin.from("entities").update({ merged_into_id: null }).eq("merged_into_id", entityId), "unlink entities merged into it");
  await check(admin.from("pages").update({ entity_id: null }).eq("entity_id", entityId), "unlink its pages");
  await check(admin.from("pages").update({ context_entity_id: null }).eq("context_entity_id", entityId), "unlink its pages");
  await check(admin.from("domains").update({ context_entity_id: null }).eq("context_entity_id", entityId), "unlink its domains");
  await check(admin.from("entities").delete().eq("id", entityId), "delete the entity");
  return { deleted: 1 };
}

// hierarchy_changes (context_hierarchy migration) is not in the generated types; skipped where it does not exist
async function dropHierarchyHistory(admin: SupabaseClient, entityId: string): Promise<void> {
  const { error } = await admin.from("hierarchy_changes").delete().eq("entity_id", entityId);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw new Error(`Could not drop its hierarchy history: ${error.message}`);
}

// Throws a readable error when a write failed
async function check(write: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await write;
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}
