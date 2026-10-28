import type { AgentToolDef } from "../types";
import { deleteTools } from "./delete";
import { readTools } from "./read";
import { settingsTools } from "./settings";
import { spacesTools } from "./spaces";
import { writeTools } from "./write";

// EVERY MCP TOOL. Each lane owns its own file; only the orchestrator edits this one.
export const ALL_TOOLS: AgentToolDef[] = [...readTools, ...writeTools, ...deleteTools, ...spacesTools, ...settingsTools];
