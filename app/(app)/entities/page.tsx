import { ReadingPane } from "@/components/shell";
import { EntitiesTable } from "./EntitiesTable";
import { NewEntityButton } from "./NewEntityButton";

// ENTITIES (/entities): the real things claims are about
export default function EntitiesPage() {
  return (
    <ReadingPane title="Entities" actions={<NewEntityButton />}>
      <EntitiesTable />
    </ReadingPane>
  );
}
