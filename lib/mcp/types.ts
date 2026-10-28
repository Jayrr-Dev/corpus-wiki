import type { z } from "zod";
import type { AgentScope } from "@/lib/agents/scopes";
import type { AgentSession } from "@/lib/agents/types";

// =====================================================================
// ONE MCP TOOL. Each lane exports an array of these from its own file in
// lib/mcp/tools/; lib/mcp/tools/index.ts joins them. The server lists a
// tool only when the key holds its scope, checks the scope again on
// every call, parses `input`, and runs `run` inside the agent session.
// =====================================================================

export type ToolContext = { session: AgentSession };

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type AgentToolDef = {
  name: string;
  title: string;
  description: string;
  scope: AgentScope;
  input: z.ZodObject;
  annotations: ToolAnnotations;
  // Returns plain JSON. Throw an Error with a clear message on failure.
  run: (args: never, context: ToolContext) => Promise<unknown>;
};

// Keeps each tool's `run` typed by its own input schema
export function defineTool<S extends z.ZodObject>(
  tool: Omit<AgentToolDef, "input" | "run"> & { input: S; run: (args: z.infer<S>, context: ToolContext) => Promise<unknown> },
): AgentToolDef {
  return tool as AgentToolDef;
}
