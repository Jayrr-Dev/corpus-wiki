import { ChangeIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// CHANGES (/changes): stub from agent A; agent E builds it
export default function ChangesPage() {
  return (
    <ReadingPane title="Changes">
      <EmptyState icon={ChangeIcon} title="No changes yet" />
    </ReadingPane>
  );
}
