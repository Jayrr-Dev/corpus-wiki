"use client";

import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/app/(app)/_components/bits";
import type { MemoryEntry } from "@/lib/ai/memory";
import type { SkillLibrary } from "@/lib/ai/skills/types";
import { readAiSkills } from "@/lib/server-actions/skills";
import type { ModelSettings } from "../settings/loadModelSettings";
import { RolesTab } from "./RolesTab";

// AGENT ROLES: the roster of AI roles, read from the same skill library as /workflow.
// The page passes the library and memory it read on the server; a failed read is asked again here.
export function AgentRolesScreen({modelSettings,initialLibrary,initialMemory}:{modelSettings:ModelSettings;initialLibrary?:SkillLibrary;initialMemory?:Record<string,MemoryEntry[]>}) {
  const library=useQuery({queryKey:["table","ai_skills","library"],initialData:initialLibrary,queryFn:async()=>{
    const result=await readAiSkills(); if (!result.ok) throw new Error(result.error); return result;
  }});
  return <QueryState query={library}>{library.data ? <RolesTab library={library.data} modelSettings={modelSettings} initialMemory={initialMemory} /> : null}</QueryState>;
}
