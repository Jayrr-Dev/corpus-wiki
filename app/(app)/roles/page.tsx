import { ReadingPane } from "@/components/shell";
import { loadModelSettings } from "../settings/loadModelSettings";
import { AgentRolesScreen } from "./AgentRolesScreen";

export default async function AgentRolesPage() {
  const modelSettings = await loadModelSettings();
  return <ReadingPane title="Agent Roles"><AgentRolesScreen modelSettings={modelSettings} /></ReadingPane>;
}
