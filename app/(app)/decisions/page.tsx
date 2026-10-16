import { ReadingPane } from "@/components/shell";
import { DecisionsTable } from "./DecisionsTable";
export default function DecisionsPage() {
  return <ReadingPane title="Decisions" width="full"><DecisionsTable /></ReadingPane>;
}
