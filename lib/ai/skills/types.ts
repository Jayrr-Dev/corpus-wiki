export const AI_STAGES = [
  { id: "extract_knowledge", name: "Extract knowledge", description: "Turn source passages into precise, cited claims." },
  { id: "identify_entities", name: "Identify entities", description: "Recognize people, companies, projects, policies, and concepts." },
  { id: "link_knowledge", name: "Link related knowledge", description: "Connect claims with meaningful, supported relationships." },
  { id: "organize_topics", name: "Organize contexts and topics", description: "Place knowledge under the right entity, topic, and subtopic." },
  { id: "define_concepts", name: "Define concepts", description: "Explain terms and procedures using their supporting sources." },
  { id: "plan_articles", name: "Plan articles", description: "Choose titles, introductions, and useful topic sections." },
  { id: "write_articles", name: "Write articles", description: "Write clear paragraphs while preserving facts and citations." },
] as const;
export type AiStage = (typeof AI_STAGES)[number]["id"];
export type AiSkill = {
  id: string; name: string; description: string; instructions: string; version: number;
  builtin_key: string | null; archived_at: string | null; updated_at: string;
};
export type AssignedSkill = Pick<AiSkill, "id" | "name" | "instructions" | "version">;
export type StageSkills = Partial<Record<AiStage, AssignedSkill | null>>;
export type SkillAssignment = { stage: AiStage; skill_id: string | null };
export type SkillLibrary = { skills: AiSkill[]; assignments: SkillAssignment[] };
