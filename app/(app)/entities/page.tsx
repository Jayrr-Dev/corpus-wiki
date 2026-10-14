import { ReadingPane } from "@/components/shell";
import { EntitiesTable } from "./EntitiesTable";

// ENTITIES (/entities): the real things claims are about
export default function EntitiesPage() {
  return (
    <ReadingPane title="Entities">
      <EntitiesTable />
    </ReadingPane>
  );
}
