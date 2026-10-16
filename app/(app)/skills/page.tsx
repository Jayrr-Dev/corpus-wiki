import { ReadingPane } from "@/components/shell";
import { loadModelSettings } from "../settings/loadModelSettings";
import { SkillsScreen } from "./SkillsScreen";

export default async function SkillsPage() {
  const modelSettings = await loadModelSettings();
  return <ReadingPane title="Workflow"><SkillsScreen modelSettings={modelSettings} /></ReadingPane>;
}
