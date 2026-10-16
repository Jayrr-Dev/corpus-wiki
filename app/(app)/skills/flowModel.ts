import { AI_STAGES, type AiStage, type SkillLibrary } from "@/lib/ai/skills/types";
import { defaultSkill } from "@/lib/ai/skills/defaults";
import { FIXED_ROLES, STAGE_ROLES } from "@/lib/ai/roles";

export function flowRole(id: string, library: SkillLibrary) {
  const stage = AI_STAGES.find((item) => item.id === id);
  const fixed = FIXED_ROLES.find((item) => item.id === id);
  const assignment = library.assignments.find((item) => item.stage === id);
  const skill = stage ? assignment ? library.skills.find((item) => item.id === assignment.skill_id && !item.archived_at) : defaultSkill(stage.id) : undefined;
  const override = library.roleInstructions?.find((item) => item.role === id);
  return {
    id, name: stage ? STAGE_ROLES[id as AiStage] : fixed?.name ?? id,
    skill: override ? "Custom role instructions" : skill?.name ?? (fixed ? "Role policy" : assignment?.skill_id ? "Assigned skill unavailable" : "App rules only"),
    version: override?.version ?? skill?.version ?? (fixed ? 1 : undefined),
    instructions: override?.instructions ?? skill?.instructions ?? fixed?.instructions ?? "App rules only; no additional skill instructions assigned.",
  };
}

export type FlowNode = {
  id: string; x: number; y: number; width: number; height: number;
  title: string; label: string; description: string; detail: string;
  kind: "input" | "role" | "gate" | "output" | "system";
  icon: "source" | "roles" | "check" | "store" | "entity" | "define" | "plan" | "write" | "page" | "organize" | "duplicates" | "search" | "stop";
  roles?: string[];
};
export type FlowEdge = { from: string; to: string; path: string; label?: string; x?: number; y?: number; branch?: boolean };
export type Flow = { title: string; description: string; width: number; height: number; nodes: [FlowNode, ...FlowNode[]]; edges: FlowEdge[] };

export const KNOWLEDGE_FLOW: Flow = {
  title: "From sources to living knowledge",
  description: "Follow a file through shared reasoning, checked changes, and source-backed articles.",
  width: 1340, height: 1080,
  nodes: [
    { id: "source", x: 35, y: 100, width: 235, height: 160, title: "Your sources", label: "01 · Receive", description: "Files become source passages.", detail: "The app records the file and its source date, extracts passages, and skips identical uploads. Claims keep their links to the original evidence.", kind: "input", icon: "source" },
    { id: "reconcile", x: 335, y: 85, width: 320, height: 360, title: "Understand the evidence", label: "02 · Reconcile", description: "Four roles guide one shared draft.", detail: "The Reconciler reads the new passages against existing knowledge. These four role instructions are combined in one model request to propose claims, identities, relationships, and topic placement. A duplicate guard checks the draft before it is submitted.", kind: "role", icon: "roles", roles: ["extract_knowledge", "identify_entities", "link_knowledge", "organize_topics"] },
    { id: "checks", x: 725, y: 100, width: 240, height: 160, title: "Check proposed changes", label: "03 · Change control", description: "Validate evidence and revisions.", detail: "Change control validates proposed actions before committing them. Changes that need a decision, including new root domains, are presented to you through Exceptions. Safe changes can be committed automatically.", kind: "gate", icon: "check" },
    { id: "knowledge", x: 1030, y: 100, width: 270, height: 160, title: "Saved knowledge", label: "04 · Commit", description: "Cited claims, entities, and links.", detail: "Accepted changes enter the knowledge store. Claim embeddings support later matching and duplicate checks. Every saved claim retains its supporting source references.", kind: "system", icon: "store" },
    { id: "decision", x: 725, y: 350, width: 240, height: 150, title: "Your review", label: "When needed", description: "Resolve a decision in Exceptions.", detail: "Some changes require a person to approve or reject them. Root approval can defer an upload; once the decisions are resolved, the app can finish its enrichment and page work.", kind: "gate", icon: "check" },
    { id: "entities", x: 1030, y: 350, width: 270, height: 155, title: "Describe new entities", label: "05 · Enrich", description: "Give recognized subjects context.", detail: "The Entity analyst adds short descriptions for newly created entities before the app proposes pages. This reuses the same role and skill as entity identification.", kind: "role", icon: "entity", roles: ["identify_entities"] },
    { id: "define", x: 1030, y: 595, width: 270, height: 195, title: "Explain the concepts", label: "06 · Define", description: "Build definitions from saved evidence.", detail: "The Definer expands supported terms and procedures using existing claims and their source passages. Definitions stay within what the project evidence establishes.", kind: "role", icon: "define", roles: ["define_concepts"] },
    { id: "plan", x: 725, y: 595, width: 240, height: 195, title: "Shape the article", label: "07 · Plan", description: "Choose the title and useful sections.", detail: "The Planner groups verified claims into an introduction and coherent topic sections. The outline assigns claim references; the Writer handles the prose.", kind: "role", icon: "plan", roles: ["plan_articles"] },
    { id: "write", x: 405, y: 595, width: 250, height: 195, title: "Write from the claims", label: "08 · Write", description: "Turn evidence into readable paragraphs.", detail: "The Writer rebuilds affected generated sections using their assigned claims and source references. Handwritten text is preserved by the page update rules.", kind: "role", icon: "write", roles: ["write_articles"] },
    { id: "article", x: 35, y: 595, width: 295, height: 160, title: "Living articles", label: "09 · Publish in your workspace", description: "Readable knowledge, linked to its sources.", detail: "Pages reflect the committed knowledge and can be updated when new evidence arrives. This is the workspace's article output; it does not publish to a public website.", kind: "output", icon: "page" },
    { id: "hierarchy", x: 35, y: 885, width: 295, height: 145, title: "Maintain the hierarchy", label: "10 · Organize", description: "Keep approved contexts in order.", detail: "After rebuilding, the app maintains the existing approved entity hierarchy. This is a system maintenance step, separate from the Organizer's role in the initial shared draft.", kind: "system", icon: "organize" },
    { id: "dedupe", x: 405, y: 885, width: 300, height: 145, title: "Duplicate reviewer", label: "11 · Clean up", description: "Check for repeated claims.", detail: "A final cleaning cycle finds duplicated claims. Proposed merges that need a person's decision appear in Exceptions. The Duplicate reviewer is an additional internal role with app-managed instructions.", kind: "system", icon: "duplicates" },
  ],
  edges: [
    { from: "source", to: "reconcile", path: "M270 180H335" },
    { from: "reconcile", to: "checks", path: "M655 180H725" },
    { from: "checks", to: "knowledge", path: "M965 180H1030" },
    { from: "checks", to: "decision", path: "M825 260V350", branch: true, label: "Needs you", x: 825, y: 305 },
    { from: "decision", to: "checks", path: "M965 425H990V285H920V260", branch: true },
    { from: "knowledge", to: "entities", path: "M1165 260V350" },
    { from: "entities", to: "define", path: "M1165 505V595" },
    { from: "define", to: "plan", path: "M1030 675H965" },
    { from: "plan", to: "write", path: "M725 675H655" },
    { from: "write", to: "article", path: "M405 675H330" },
    { from: "article", to: "hierarchy", path: "M180 755V885", label: "Then maintain", x: 180, y: 830 },
    { from: "hierarchy", to: "dedupe", path: "M330 955H405" },
  ],
};

export const RESEARCH_FLOW: Flow = {
  title: "Outside research, with two approval gates",
  description: "Optional research starts with a real knowledge gap. The Reviewer decides what can enter.",
  width: 1340, height: 910,
  nodes: [
    { id: "gap", x: 35, y: 95, width: 240, height: 170, title: "A specific gap", label: "01 · Optional branch", description: "An article needs evidence the project lacks.", detail: "Outside research can be requested while building a section or filling a thin section. Existing project facts and saved knowledge provide the context; a short section alone is not a demonstrated research need.", kind: "input", icon: "page" },
    { id: "propose", x: 355, y: 95, width: 270, height: 215, title: "Propose the research", label: "02 · Justify", description: "Explain the gap and suggest a query.", detail: "The Researcher checks whether saved knowledge already answers the question, then proposes a specific gap, justification, and search query. It does not approve its own proposal.", kind: "role", icon: "search", roles: ["researcher"] },
    { id: "approve-search", x: 710, y: 95, width: 255, height: 215, title: "Is research needed?", label: "03 · Independent decision", description: "Approve the need before searching.", detail: "The Reviewer receives a fresh context containing the project facts and proposal. Only an approved, actionable proposal authorizes web search. Rejected proposals stop here.", kind: "gate", icon: "check", roles: ["reviewer"] },
    { id: "search", x: 1040, y: 95, width: 260, height: 170, title: "Search the web", label: "04 · Search", description: "Find sources for the approved question.", detail: "The app searches using the approved query and fetches candidate source text. Finding a page does not yet admit its content into project knowledge.", kind: "system", icon: "search" },
    { id: "select", x: 1040, y: 440, width: 260, height: 215, title: "Select source evidence", label: "05 · Propose excerpts", description: "Choose exact passages that answer the gap.", detail: "The Researcher justifies each candidate source and selects verbatim excerpts. Excerpts must occur in the fetched source text. A source can contribute nothing and be discarded.", kind: "role", icon: "source", roles: ["researcher"] },
    { id: "approve-source", x: 710, y: 440, width: 255, height: 215, title: "Does this evidence fit?", label: "06 · Independent decision", description: "Approve only the useful excerpts.", detail: "The Reviewer independently checks the source, project context, and proposed excerpts. Only selected valid excerpts can be admitted. An approval without usable excerpts still admits no evidence.", kind: "gate", icon: "check", roles: ["reviewer"] },
    { id: "admit", x: 355, y: 440, width: 270, height: 170, title: "Admit approved evidence", label: "07 · Scoped ingestion", description: "Extract cited claims from accepted excerpts.", detail: "Approved excerpts pass through scoped reconciliation and change control. They add evidence in established reference domains, without changing the project's taxonomy or internal company policies.", kind: "system", icon: "store" },
    { id: "return", x: 35, y: 440, width: 240, height: 215, title: "Update the section", label: "08 · Return to the article", description: "Write with the newly accepted claims.", detail: "Accepted external claims join the section's relevant internal claims. The Writer rebuilds the section with citations; rejected proposals and sources add no claims.", kind: "output", icon: "write", roles: ["write_articles"] },
    { id: "stop", x: 710, y: 770, width: 330, height: 110, title: "Stop · nothing admitted", label: "Rejected or insufficient", description: "The decision and its reason are recorded.", detail: "Both gates default to rejection when the benefit or evidence is insufficient. The app records the reason, models, instructions, and token usage for the decision.", kind: "system", icon: "stop" },
  ],
  edges: [
    { from: "gap", to: "propose", path: "M275 180H355" },
    { from: "propose", to: "approve-search", path: "M625 180H710" },
    { from: "approve-search", to: "search", path: "M965 180H1040", label: "Yes", x: 1002, y: 162 },
    { from: "search", to: "select", path: "M1170 265V440", label: "Each source", x: 1170, y: 355 },
    { from: "select", to: "approve-source", path: "M1040 535H965" },
    { from: "approve-source", to: "admit", path: "M710 535H625", label: "Yes", x: 667, y: 517 },
    { from: "admit", to: "return", path: "M355 535H275" },
    { from: "approve-search", to: "stop", path: "M790 310V365H675V825H710", branch: true, label: "No", x: 705, y: 365 },
    { from: "approve-source", to: "stop", path: "M840 655V770", branch: true, label: "No", x: 840, y: 715 },
  ],
};
