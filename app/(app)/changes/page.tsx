import { ReadingPane } from "@/components/shell";
import { ChangesTable } from "./ChangesTable";

// CHANGES (/changes): every ChangeSet, newest first
export default function ChangesPage() {
  return (
    <ReadingPane title="Changes">
      <ChangesTable />
    </ReadingPane>
  );
}
