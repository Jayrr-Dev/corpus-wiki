import { ARTICLE_STAGES, ENRICHMENT_STAGES, KNOWLEDGE_STAGES } from "@/lib/ingest/workflowTypes";

export type InstructionControl = "skills" | "roles" | "builtin" | "system";
export type OverviewStep = { id: string; name: string; description: string; detail: string; control: InstructionControl; trigger?: string };
export type OverviewPhase = { id: string; name: string; trigger: string; steps: OverviewStep[] };
type UploadStage = (typeof KNOWLEDGE_STAGES)[number] | (typeof ARTICLE_STAGES)[number] | (typeof ENRICHMENT_STAGES)[number];

// The upload order comes from the runner's stage lists. Every runtime stage
// must have an explanation here, including indexing and conditional passes.
const UPLOAD_STEPS: Record<UploadStage, Omit<OverviewStep, "id">> = {
  embeddings: { name: "Index evidence", description: "Make saved claims and passages searchable by meaning.", detail: "The app stores vectors for current claim revisions and source passages. These support matching, duplicate checks and related-evidence retrieval.", control: "system" },
  duplicates: { name: "Review duplicate claims", description: "Merge repeated knowledge while retaining citations.", detail: "The Duplicate reviewer compares claims this upload touched. Confident, near-identical merges can apply automatically; other merges can wait in Exceptions.", control: "builtin" },
  tidy: { name: "Clean up entities", description: "Merge duplicate people, organizations, and other subjects.", detail: "Entity cleanup proposes merges and retirements through Change control. The app supplies this step's instructions.", control: "builtin" },
  place: { name: "File claims into topics", description: "Place the file's claims in the topic tree.", detail: "Topic placement runs after cleanup. A proposed new root topic pauses the upload until its approval is resolved.", control: "builtin" },
  "embeddings-cleaned": { name: "Refresh the search index", description: "Index claim wording changed during cleanup.", detail: "A merged or revised claim needs a vector for its new revision before article review retrieves related evidence. Failed indexing remains resumable.", control: "system" },
  hierarchy: { name: "Group related topics", description: "Group topics under the people or organizations they belong to.", detail: "The app maintains approved contexts before planning the first articles. This step does not call an AI model.", control: "system" },
  plan: { name: "Plan and approve articles", description: "Plan outlines; independently review new articles.", detail: "The Planner proposes articles and updates. The Article reviewer approves, redirects or rejects new article proposals. Planner skill instructions and Article reviewer role instructions are edited separately.", control: "roles" },
  pages: { name: "Write and review sections", description: "Write cited paragraphs, check support, then review pages.", detail: "The Writer uses its assigned skill. Built-in checks assess lines against cited claims and review rebuilt pages. Edits to your own lines can wait for approval. Editorial checking policies are managed by the app.", control: "skills" },
  describe: { name: "Describe entities", description: "Add short descriptions to recognized subjects.", detail: "The Entity analyst uses its effective skill instructions to describe new entities after the first articles are available.", control: "skills" },
  profiles: { name: "Build stakeholder profiles", description: "Create cards and optional web profiles.", detail: "Profiles use saved evidence. With outside knowledge enabled, stakeholder lookups can add web profiles. Saving web content as project knowledge requires independent source approval.", control: "builtin" },
  expand: { name: "Explain key terms", description: "Extract useful terms from source evidence.", detail: "The Definer uses source passages and saved claims to explain supported terms. It cannot invent definitions from background knowledge.", control: "skills" },
  "embeddings-enrichment": { name: "Index new definitions", description: "Make added or revised enrichment claims searchable.", detail: "Runs when enrichment changes claim revisions. Indexing finishes before the enrichment article pass.", control: "system" },
  "hierarchy-enrichment": { name: "File enriched knowledge", description: "Refresh contexts when enrichment changes claims.", detail: "This separate, checkpointed pass runs only when enrichment adds or revises knowledge.", control: "system" },
  "plan-enrichment": { name: "Plan article updates", description: "Plan from the newly enriched knowledge.", detail: "Conditional on changed claims. Uses separate checkpoints so the first article plan is not incorrectly reused.", control: "roles" },
  "pages-enrichment": { name: "Update affected articles", description: "Write and review the affected sections again.", detail: "Conditional on changed claims. Completed first-pass sections remain saved; failed background work resumes from its own checkpoints.", control: "skills" },
  glossary: { name: "Generate the glossary", description: "Write cited entries and index them for search.", detail: "The Dictionary editor creates glossary entries from live knowledge and its source evidence. Its generation policy is built into the app.", control: "builtin" },
  curate: { name: "Maintain the page tree", description: "Curate structure, refresh overviews and delegate follow-up work.", detail: "The Curator can merge, move, rename and type pages, then ask the Planner, Reviewer or Researcher for follow-up work. Risky changes wait for approval. Failed maintenance stays unfinished and can resume.", control: "roles" },
};
const uploadSteps = (ids: readonly UploadStage[]): OverviewStep[] => ids.map((id) => ({ id, ...UPLOAD_STEPS[id] }));

export const UPLOAD_PHASES: OverviewPhase[] = [
  { id: "knowledge", name: "Organize your source", trigger: "Starts with an upload or source rerun.", steps: [
    { id: "receive", name: "Read your source", description: "Check duplicates, store the source and extract passages.", detail: "The source date and evidence links are retained. Images and videos use built-in media analysis when needed before their descriptions become passages.", control: "builtin" },
    { id: "reconcile", name: "Extract and connect facts", description: "Identify facts, people, and topics, then connect them to existing knowledge.", detail: "Extractor, Entity analyst, Linker, Organizer and Definer instructions jointly guide one reconciliation request. They are not five sequential processing calls. Change control checks and commits the proposed knowledge.", control: "skills" },
    ...uploadSteps(KNOWLEDGE_STAGES),
  ] },
  { id: "articles", name: "Create your articles", trigger: "Starts after knowledge cleanup and filing finish.", steps: uploadSteps(ARTICLE_STAGES) },
  { id: "enrichment", name: "Improve in the background", trigger: "Runs in the background after reviewed articles are ready.", steps: uploadSteps(ENRICHMENT_STAGES) },
];

export const OTHER_PHASES: OverviewPhase[] = [
  { id: "research", name: "Outside research", trigger: "When requested by section work, stakeholder source saving or Curator follow-up, with outside knowledge enabled.", steps: [
    { id: "research-proposal", name: "Propose a knowledge gap", description: "The Researcher checks project context and suggests a query.", detail: "Existing internal project evidence must justify the research. A short section by itself is not evidence of a gap.", control: "roles" },
    { id: "research-approval", name: "Approve the search", description: "The Reviewer independently decides whether to search.", detail: "The Reviewer receives a fresh context and cannot inherit the Researcher's instructions or approve an empty proposal.", control: "roles" },
    { id: "research-excerpts", name: "Search and select excerpts", description: "Find sources and select exact supporting passages.", detail: "Search results are candidates, not admitted knowledge. Excerpts must occur verbatim in the fetched source.", control: "roles" },
    { id: "source-approval", name: "Approve source evidence", description: "The Reviewer independently selects which excerpts can enter.", detail: "Only approved, valid excerpts can be stored. Research decisions are recorded in Changes; approving a source without usable excerpts admits no knowledge.", control: "roles" },
    { id: "research-ingest", name: "Ingest and update the section", description: "Add scoped claims, then write the section with citations.", detail: "Scoped reconciliation cannot create topics or overwrite project policies. If writing fails after a section is replaced, recovery resumes the replacement section.", control: "skills" },
  ] },
  { id: "on-request", name: "Tasks you can start", trigger: "When you explicitly start a review, refresh or maintenance action.", steps: [
    { id: "domain-review", name: "Review the topic tree", description: "The Domain steward proposes a useful structural change.", detail: "Uncertain changes or questions can wait in Exceptions. Its role instructions are editable in Agent Roles.", control: "roles" },
    { id: "manual-links", name: "Link existing knowledge", description: "Find supported relationships among saved claims.", detail: "The Linker uses its effective skill instructions and submits relationships through Change control.", control: "skills" },
    { id: "manual-maintenance", name: "Review, improve or refresh", description: "Run page review, article improvement, cleanup or profile refresh.", detail: "Manual actions reuse their respective roles and validation paths. The Curator also runs automatically at the end of uploads.", control: "roles" },
  ] },
];

export const WORKFLOW_SAFEGUARDS = [
  { id: "change-control", name: "Change control", description: "Review applied changes and undo them when needed.", href: "/changes" },
  { id: "approvals", name: "Your approvals", description: "Resolve changes waiting for your approval in Exceptions.", href: "/exceptions" },
  { id: "recovery", name: "Progress and recovery", description: "Track uploads and resume unfinished work. Completed steps stay saved.", href: "/upload" },
  { id: "settings", name: "Models and outside knowledge", description: "Choose providers and models, and control whether outside knowledge is allowed.", href: "/settings" },
] as const;
