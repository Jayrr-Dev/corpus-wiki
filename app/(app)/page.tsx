import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// PAGES (/): stub from agent A; agent E builds it
export default function PagesIndexPage() {
  return (
    <ReadingPane title="Pages">
      <EmptyState icon={PageIcon} title="No pages yet" />
    </ReadingPane>
  );
}
