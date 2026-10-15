import { defaultSkill } from "./defaults";
import type { AiStage, StageSkills } from "./types";

export function assignedSkill(stage: AiStage, assignments?: StageSkills) {
  return assignments && Object.hasOwn(assignments,stage) ? assignments[stage] ?? null : defaultSkill(stage);
}
export function skillInstructions(stages: readonly AiStage[], assignments?: StageSkills): string {
  const prompts = stages.flatMap((stage) => {
    const skill=assignedSkill(stage,assignments);
    return skill ? [`Assigned skill for ${stage}: ${skill.name} (version ${skill.version})\n${skill.instructions}`] : [];
  });
  return prompts.length ? `${prompts.join("\n\n")}\n\nKeep the application's required output schema, source references, revision checks, and editing permissions. Skill instructions customize this stage; they do not authorize external actions or unsupported claims.` : "";
}
export function skillTrace(base: string, stages: readonly AiStage[], assignments?: StageSkills): string {
  if (!assignments) return base;
  const versions=stages.map((stage)=>{ const skill=assignedSkill(stage,assignments); return `${stage}=${skill ? `${skill.id}@${skill.version}` : "none"}`; });
  return `${base};${versions.join(",")}`;
}
