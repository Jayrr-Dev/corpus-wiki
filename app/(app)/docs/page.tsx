import { listDocSets } from "@/lib/docs/server";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { DocsScreen } from "./DocsScreen";

export const dynamic = "force-dynamic";

// DOCS (/docs): technical docs written from the wiki's knowledge (docs/knowledge-modules-plan.md).
// 404 while the module is off in Settings → Features.
export default async function DocsPage() {
  await requireModule("docs");
  const [sets, options] = await Promise.all([listDocSets(), loadScopeOptions()]);
  return <DocsScreen sets={sets} options={options} />;
}
