import { EntityIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";

// ENTITIES (/entities): stub from agent A; agent E builds it
export default function EntitiesPage() {
  return (
    <ReadingPane title="Entities">
      <EmptyState icon={EntityIcon} title="No entities yet" />
    </ReadingPane>
  );
}
