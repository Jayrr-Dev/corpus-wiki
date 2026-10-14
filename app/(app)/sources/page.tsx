import { SourceIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// SOURCES (/sources): stub from agent A; agent E builds it
export default function SourcesPage() {
  return (
    <ReadingPane title="Sources">
      <EmptyState icon={SourceIcon} title="No sources uploaded yet" />
    </ReadingPane>
  );
}
