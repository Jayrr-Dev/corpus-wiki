"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { AI_STAGES } from "@/lib/ai/skills/types";
import { FIXED_ROLES } from "@/lib/ai/roles";
import { loadSkillLibrary, skillInputSchema, type SkillInput } from "@/lib/ai/skills/server";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";

export async function readAiSkills() {
  return toActionResult(async()=>{
    await requireUser();
    const db = supabaseRpc(getAdminSupabase());
    return loadSkillLibrary(db);
  });
}
export async function saveRoleInstructions(role: string, instructions: string | null, expectedVersion: number | null) {
  return toActionResult(async () => {
    await requireUser();
    if (!AI_STAGES.some((item) => item.id === role) && !FIXED_ROLES.some((item) => item.id === role)) throw new Error("Unknown AI role.");
    const value = z.string().trim().min(1).max(20000).nullable().parse(instructions);
    z.number().int().positive().nullable().parse(expectedVersion);
    await supabaseRpc(getAdminSupabase()).call("save_ai_role_instructions", { p_role: role, p_instructions: value, p_expected_version: expectedVersion });
    return {};
  });
}
export async function saveAiSkill(input:SkillInput) {
  return toActionResult(async()=>{
    await requireUser();
    const value=skillInputSchema.parse(input);
    try { await supabaseRpc(getAdminSupabase()).call("save_ai_skill",{p_id:value.id,p_expected_version:value.expectedVersion,p_name:value.name,p_description:value.description,p_instructions:value.instructions}); }
    catch (error) { if (error instanceof Error && error.message.includes("ai_skills_active_name")) throw new Error("An active skill already uses this name."); throw error; }
    return {};
  });
}
export async function assignAiSkill(stage:string,skillId:string|null) {
  return toActionResult(async()=>{
    await requireUser();
    if (!AI_STAGES.some((item)=>item.id===stage)) throw new Error("Unknown AI stage.");
    z.uuid().nullable().parse(skillId);
    await supabaseRpc(getAdminSupabase()).call("assign_ai_stage_skill",{p_stage:stage,p_skill_id:skillId});
    return {};
  });
}
export async function archiveAiSkill(id:string,expectedVersion:number,archive:boolean) {
  return toActionResult(async()=>{
    await requireUser();
    z.uuid().parse(id);z.number().int().positive().parse(expectedVersion);z.boolean().parse(archive);
    await supabaseRpc(getAdminSupabase()).call("archive_ai_skill",{p_id:id,p_expected_version:expectedVersion,p_archive:archive});
    return {};
  });
}
