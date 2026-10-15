import "server-only";
import type { DbRpc } from "@/lib/db/rpc";
import type { PageCandidate } from "./proposePages";

export async function organizeEventHierarchy(db: DbRpc, eventId: string): Promise<void> {
  const candidates = await db.call<PageCandidate[]>("page_candidates", { p_event_id: eventId });
  for (const candidate of candidates.filter((item) => ["company", "organization", "project", "person", "team", "product"].includes(item.type))) {
    await db.call("organize_entity_context", { p_entity_id: candidate.entityId });
  }
}
