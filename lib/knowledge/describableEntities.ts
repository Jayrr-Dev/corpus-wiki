import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";

// ids per `.in()` read, so a long backlog stays under the URL length limit
const ID_CHUNK = 100;

// DESCRIBABLE ENTITIES: live entities without a description that some live unit
// mentions, by name. One with no live unit has nothing to describe it from, so the
// graph's auto describe neither counts nor plans it (it would only be skipped).
// Shared by the server plan and the browser count so both agree.
export async function fetchDescribableEntityIds(client: SupabaseClient<Database>): Promise<string[]> {
  const entities = await client.from("entities").select("id").is("description", null).is("merged_into_id", null).is("retired_at", null).order("name");
  if (entities.error) throw entities.error;
  const ids = entities.data.map((entity) => entity.id);
  const mentioned = new Set<string>();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const links = await client.from("unit_entities").select("unit_id, entity_id").in("entity_id", ids.slice(index, index + ID_CHUNK));
    if (links.error) throw links.error;
    const unitIds = [...new Set(links.data.map((link) => link.unit_id))];
    const live = new Set<string>();
    for (let start = 0; start < unitIds.length; start += ID_CHUNK) {
      const units = await client.from("units").select("id").in("id", unitIds.slice(start, start + ID_CHUNK)).is("retired_at", null);
      if (units.error) throw units.error;
      for (const unit of units.data) live.add(unit.id);
    }
    for (const link of links.data) if (live.has(link.unit_id)) mentioned.add(link.entity_id);
  }
  return ids.filter((id) => mentioned.has(id));
}
