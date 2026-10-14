import { UnitIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// KNOWLEDGE (/units): stub from agent A; agent E builds it
export default function UnitsPage() {
  return (
    <ReadingPane title="Knowledge">
      <EmptyState icon={UnitIcon} title="No knowledge units yet" />
    </ReadingPane>
  );
}
