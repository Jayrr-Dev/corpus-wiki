"use client";

import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/app/(app)/_components/bits";
import { readAiSkills } from "@/lib/server-actions/skills";
import type { ModelSettings } from "../settings/loadModelSettings";
import { RolesTab } from "./RolesTab";

// AGENT ROLES: the roster of AI roles, read from the same skill library as /workflow
export function AgentRolesScreen({modelSettings}:{modelSettings:ModelSettings}) {
  const library=useQuery({queryKey:["table","ai_skills","library"],queryFn:async()=>{
    const result=await readAiSkills(); if (!result.ok) throw new Error(result.error); return result;
  }});
  return <QueryState query={library}>{library.data ? <RolesTab library={library.data} modelSettings={modelSettings} /> : null}</QueryState>;
}
