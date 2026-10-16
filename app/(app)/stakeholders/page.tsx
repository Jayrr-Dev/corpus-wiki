import { ReadingPane } from "@/components/shell";
import { StakeholdersScreen } from "./StakeholdersScreen";

// STAKEHOLDERS (/stakeholders): quick-reference cards for the parties in the knowledge
export default function StakeholdersPage() {
  return (
    <ReadingPane title="Stakeholders">
      <StakeholdersScreen />
    </ReadingPane>
  );
}
