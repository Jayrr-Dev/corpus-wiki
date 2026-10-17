import "server-only";
import { z } from "zod";
import type { DbRpc } from "@/lib/db/rpc";
import { AI_STAGES, type RoleInstruction, type SkillLibrary, type StageSkills } from "./types";
import { defaultSkill } from "./defaults";

export const skillInputSchema=z.object({
  id:z.uuid().nullable(), expectedVersion:z.number().int().positive().nullable(),
  name:z.string().trim().min(1).max(100), description:z.string().trim().max(500), instructions:z.string().trim().min(1).max(20000),
}).refine((input)=>input.id ? input.expectedVersion!==null : input.expectedVersion===null,"An edit requires its current version.");
export type SkillInput=z.infer<typeof skillInputSchema>;
export async function loadSkillLibrary(db:DbRpc):Promise<SkillLibrary> {
  const [library, roleInstructions] = await Promise.all([db.call<SkillLibrary>("get_ai_skill_library"), loadRoleInstructions(db)]);
  return { ...library, roleInstructions };
}
export async function loadRoleInstructions(db: DbRpc): Promise<RoleInstruction[]> {
  return db.call<RoleInstruction[]>("get_ai_role_instructions");
}
export function resolveStageSkills(library:SkillLibrary):StageSkills {
  const byId=new Map(library.skills.filter((skill)=>!skill.archived_at).map((skill)=>[skill.id,skill]));
  return Object.fromEntries(AI_STAGES.map(({id})=>{
    const override = library.roleInstructions?.find((row) => row.role === id);
    if (override) return [id, { id: `role:${id}`, name: `${id} role instructions`, instructions: override.instructions, version: override.version }];
    const assignment=library.assignments.find((row)=>row.stage===id);
    if (!assignment) return [id,defaultSkill(id)];
    if (!assignment.skill_id) return [id,null];
    const skill=byId.get(assignment.skill_id);
    if (!skill) throw new Error(`The assigned skill for ${id} is unavailable. Choose another skill in Workflow.`);
    return [id,{id:skill.id,name:skill.name,instructions:skill.instructions,version:skill.version}];
  }));
}
export async function loadStageSkills(db:DbRpc):Promise<StageSkills> {
  return resolveStageSkills(await loadSkillLibrary(db));
}
