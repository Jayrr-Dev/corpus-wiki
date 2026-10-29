import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { requireModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

// VIDEO (/video): narrated videos made from a topic or article (docs/knowledge-modules-plan.md).
// 404 while the module is off in Settings → Features.
export default async function VideoPage() {
  await requireModule("video");
  return (
    <ReadingPane title="Video">
      <EmptyState icon={Clapperboard} title="No videos yet." />
    </ReadingPane>
  );
}
