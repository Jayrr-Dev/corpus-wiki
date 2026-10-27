import { ReadingPane } from "@/components/shell";
import { readAiSkills, readRoleMemory } from "@/lib/server-actions/skills";
import { loadModelSettings } from "../settings/loadModelSettings";
import { AgentRolesScreen } from "./AgentRolesScreen";

// The skill library and role memory load here beside the model settings, so the screen
// opens with them instead of asking for each after it mounts
export default async function AgentRolesPage() {
  const [modelSettings, library, memory] = await Promise.all([loadModelSettings(), readAiSkills(), readRoleMemory()]);
  return <ReadingPane title="Agent Roles"><AgentRolesScreen modelSettings={modelSettings} initialLibrary={library.ok ? library : undefined} initialMemory={memory.ok ? memory.memory : undefined} /></ReadingPane>;
}
