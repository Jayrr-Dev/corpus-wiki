import { createClient } from "@supabase/supabase-js";

// ONE-OFF (delete after running): after "3.2 Utility Right of Way Process.docx" was purged,
// its topics and entities stayed (a purge retires claims only). This retires them through
// Change control as one person edit, so it shows on Changes and can be undone there:
//   - the EPCOR topic tree (retire_domain on the root retires its whole subtree)
//   - every entity created in the last 12 hours that no live claim mentions any more
// Run once, from the project folder:
//   node --experimental-strip-types --no-warnings --env-file-if-exists=.env.local scripts/db/oneoff-urw-leftovers.ts

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const must = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

const roots = must(await db.from("domains").select("id, path").eq("path", "EPCOR").is("parent_id", null).is("retired_at", null));
const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const recent = must(await db.from("entities").select("id, type, name").gte("created_at", since).is("retired_at", null).is("merged_into_id", null));
const mentioned = new Set<string>();
for (let i = 0; i < recent.length; i += 100) {
  const links = must(await db.from("unit_entities").select("entity_id, units!inner(retired_at)").in("entity_id", recent.slice(i, i + 100).map((e) => e.id)).is("units.retired_at", null));
  for (const link of links as { entity_id: string }[]) mentioned.add(link.entity_id);
}
const orphans = recent.filter((entity) => !mentioned.has(entity.id));

console.log(`Retiring topics: ${roots.map((root) => root.path).join(", ") || "none"}`);
console.log(`Retiring ${orphans.length} entities: ${orphans.map((entity) => `${entity.name} (${entity.type})`).join(", ")}`);
const reason = "Left over after purging 3.2 Utility Right of Way Process.docx";
const action = (type: string, targetId: string) => ({ type, targetId, expectedRevisionId: null, passageIds: [], speechAct: null, input: { reason } });
const actions = [...roots.map((root) => action("retire_domain", root.id)), ...orphans.map((entity) => action("retire_entity", entity.id))];
if (!actions.length) {
  console.log("Nothing to retire.");
  process.exit(0);
}
const submitted = must(await db.rpc("submit_change_set" as never, {
  p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: `Retired the leftovers of a purged file (${actions.length} items)`,
  p_trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null }, p_actions: actions,
} as never)) as { changeSetId: string };
const result = must(await db.rpc("commit_change_set" as never, { p_change_set_id: submitted.changeSetId } as never));
console.log("Committed:", result);
