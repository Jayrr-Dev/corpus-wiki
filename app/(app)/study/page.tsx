import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { requireModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

// STUDY (/study): practice questions built from the wiki's knowledge (docs/knowledge-modules-plan.md).
// 404 while the module is off in Settings → Features.
export default async function StudyPage() {
  await requireModule("study");
  return (
    <ReadingPane title="Study">
      <EmptyState icon={GraduationCap} title="No study sets yet." />
    </ReadingPane>
  );
}
