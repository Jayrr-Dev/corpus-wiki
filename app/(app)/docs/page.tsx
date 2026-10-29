import { listDocSets } from "@/lib/docs/server";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { DocsScreen } from "./DocsScreen";

export const dynamic = "force-dynamic";

// DOCS (/docs): technical docs written from the wiki's knowledge (docs/knowledge-modules-plan.md).
// ?topic= narrows the list to one button of the topic bar; ?new= opens New docs on that topic (empty: no topic). 404 while the module is off in Settings → Features.
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[]; new?: string | string[] }> }) {
  await requireModule("docs");
  const [sets, options, domains, query] = await Promise.all([listDocSets(), loadScopeOptions(), getAdminSupabase().from("domains").select("*").is("retired_at", null), searchParams]);
  if (domains.error) throw new Error(domains.error.message);
  const startTopic = typeof query.new === "string" ? query.new : null;
  // keyed so following another New docs link opens the dialog afresh
  return <DocsScreen key={startTopic ?? ""} sets={sets} options={options} domains={domains.data} topic={typeof query.topic === "string" ? query.topic : null} startTopic={startTopic} />;
}
