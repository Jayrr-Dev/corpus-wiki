import { FileCode } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { requireModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

// DOCS (/docs): technical docs written from the wiki's knowledge (docs/knowledge-modules-plan.md).
// 404 while the module is off in Settings → Features.
export default async function DocsPage() {
  await requireModule("docs");
  return (
    <ReadingPane title="Docs">
      <EmptyState icon={FileCode} title="No docs yet." />
    </ReadingPane>
  );
}
