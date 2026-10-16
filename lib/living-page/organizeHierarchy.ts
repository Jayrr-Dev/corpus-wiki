import "server-only";
import { assertActiveUpload } from "@/lib/ingest/workflowContext";
import type { DbRpc } from "@/lib/db/rpc";
import type { PageCandidate } from "./proposePages";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { typeOwnsContext } from "@/lib/knowledge/entityTypes";

export async function organizeEventHierarchy(db: DbRpc, client: AdminSupabase, eventId: string): Promise<void> {
  const candidates = await db.call<PageCandidate[]>("page_candidates", { p_event_id: eventId });
  for (const candidate of candidates.filter((item) => typeOwnsContext(item.type))) {
    await organizeExistingEntityContext(db, client, candidate.entityId);
  }
}

// Legacy organization creates a root per entity. Keep existing contexts maintained,
// but do not manufacture new roots just because extraction recognized an entity.
export async function organizeExistingEntityContext(db: DbRpc, client: AdminSupabase, entityId: string): Promise<void> {
  await assertActiveUpload();
  const { data, error } = await client.from("domains").select("id").eq("context_entity_id", entityId).is("parent_id", null).is("retired_at", null).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    // A newly approved root may precede its entity in the draft. Attach the
    // context once the entity exists, then maintain that approved root in place.
    const { data: entity, error: entityError } = await client.from("entities").select("name,type").eq("id", entityId).single();
    if (entityError) throw new Error(entityError.message);
    if (!entity || !typeOwnsContext(entity.type)) return;
    const { data: roots, error: rootError } = await client.from("domains").select("id,context_entity_id").eq("path", entity.name.replaceAll("/", "∕")).is("parent_id", null).is("retired_at", null).limit(1);
    if (rootError) throw new Error(rootError.message);
    const approvedRoot = roots?.[0];
    if (!approvedRoot || (approvedRoot.context_entity_id && approvedRoot.context_entity_id !== entityId)) return;
    const { error: attachError } = await client.from("domains").update({ context_entity_id: entityId }).eq("id", approvedRoot.id);
    if (attachError) throw new Error(attachError.message);
  }
  await db.call("organize_entity_context", { p_entity_id: entityId });
}
