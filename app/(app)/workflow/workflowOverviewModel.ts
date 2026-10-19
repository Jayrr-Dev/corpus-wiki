import { ARTICLE_STAGES, ENRICHMENT_STAGES, KNOWLEDGE_STAGES } from "@/lib/ingest/workflowTypes";

export type InstructionControl = "skills" | "roles" | "builtin" | "system";
export type OverviewStep = { id: string; name: string; description: string; detail: string; control: InstructionControl; trigger?: string };
export type OverviewPhase = { id: string; name: string; trigger: string; steps: OverviewStep[] };
type UploadStage = (typeof KNOWLEDGE_STAGES)[number] | (typeof ARTICLE_STAGES)[number] | (typeof ENRICHMENT_STAGES)[number];

// The upload order comes from the runner's stage lists. Every runtime stage
// must have an explanation here, including indexing and conditional passes.
const UPLOAD_STEPS: Record<UploadStage, Omit<OverviewStep, "id">> = {
  duplicates: { name: "Review duplicate claims", description: "Merge repeated knowledge while retaining citations.", detail: "The Duplicate reviewer compares claims this upload touched. Confident, near-identical merges can apply automatically; other merges can wait in Exceptions.", control: "builtin" },
  tidy: { name: "Clean up entities", description: "Merge duplicate people, organizations, and other subjects.", detail: "Entity cleanup proposes merges and retirements through Change control. The app supplies this step's instructions.", control: "builtin" },
  place: { name: "Assign knowledge to domains", description: "Use meaning and connections to choose the right domains.", detail: "The Domain Decider plans groups for the whole upload, compares existing domain knowledge, and reviews assignments one group at a time. Every incoming knowledge unit must be accounted for before articles start. A proposed new root still waits for your approval.", control: "roles" },
  hierarchy: { name: "Group related topics", description: "Group topics under the people or organizations they belong to.", detail: "The app maintains approved contexts before definitions and articles. This step does not call an AI model.", control: "system" },
  expand: { name: "Explain key terms", description: "Extract useful terms from source evidence.", detail: "The Definer reads the saved claims and their source passages. It adds definitions before the index, so the article pass can cite them. It cannot invent definitions from background knowledge.", control: "skills" },
  embeddings: { name: "Index evidence", description: "Make the finished claims and passages searchable by meaning.", detail: "Runs once, after cleanup and definitions. The index covers the claims articles will cite, including merged wording and new definitions.", control: "system" },
  plan: { name: "Plan and approve articles", description: "Plan outlines; independently review new articles.", detail: "The Planner proposes articles and updates. The Article reviewer approves, redirects or rejects new article proposals. Planner skill instructions and Article reviewer role instructions are edited separately.", control: "roles" },
  pages: { name: "Write and review sections", description: "Write cited paragraphs, check support, then review pages.", detail: "The Writer uses its assigned skill. Built-in checks assess lines against cited claims and review rebuilt pages. Edits to your own lines can wait for approval. Editorial checking policies are managed by the app.", control: "skills" },
  describe: { name: "Describe entities", description: "Add short descriptions to recognized subjects.", detail: "The Entity analyst uses its effective skill instructions to describe new entities after the articles are written. Descriptions are not new claims.", control: "skills" },
  profiles: { name: "Build stakeholder profiles", description: "Create cards and optional web profiles.", detail: "Profiles use saved evidence. With outside knowledge enabled, stakeholder lookups can add web profiles. Saving web content as project knowledge requires independent source approval.", control: "builtin" },
  glossary: { name: "Generate the glossary", description: "Write cited entries and index them for search.", detail: "The Dictionary editor creates glossary entries from live knowledge and its source evidence. Entries are not new claims. Its generation policy is built into the app.", control: "builtin" },
  curate: { name: "Maintain the page tree", description: "Curate structure, refresh overviews and delegate follow-up work.", detail: "The Curator can merge, move, rename and type pages, then ask the Planner, Reviewer or Researcher for follow-up work. Risky changes wait for approval. Failed maintenance stays unfinished and can resume.", control: "roles" },
};
const uploadSteps = (ids: readonly UploadStage[]): OverviewStep[] => ids.map((id) => ({ id, ...UPLOAD_STEPS[id] }));

export const UPLOAD_PHASES: OverviewPhase[] = [
  { id: "knowledge", name: "Organize your source", trigger: "Starts with an upload or source rerun.", steps: [
    { id: "receive", name: "Read your source", description: "Check duplicates, store the source and extract passages.", detail: "The source date and evidence links are retained. Images and videos use built-in media analysis when needed before their descriptions become passages.", control: "builtin" },
    { id: "reconcile", name: "Extract and connect facts", description: "Identify facts, people, and topics, then connect them to existing knowledge.", detail: "Extractor, Entity analyst, Linker, Organizer and Definer instructions jointly guide one reconciliation request. They are not five sequential processing calls. Change control checks and commits the proposed knowledge.", control: "skills" },
    ...uploadSteps(KNOWLEDGE_STAGES),
  ] },
  { id: "articles", name: "Create your articles", trigger: "Starts after definitions are saved and indexed.", steps: uploadSteps(ARTICLE_STAGES) },
  { id: "enrichment", name: "Finish in the background", trigger: "Runs after the articles are written. These steps do not add claims.", steps: uploadSteps(ENRICHMENT_STAGES) },
];

export const ILLUSTRATION_PHASE: OverviewPhase = {
  id: "illustrations", name: "Article illustrations", trigger: "Automatic assessment of changed articles, or a manual illustration request for an article or section.", steps: [
    { id: "visual-context", name: "Choose what needs a picture", description: "Read the article, its evidence and existing images.", detail: "Composer checks the current article and available assets. It can keep unchanged illustrations, replace a requested section image, or omit an image when none would help. An article has a three-illustration limit.", control: "roles" },
    { id: "visual-select", name: "Reuse, search or create", description: "Choose a library image, a verified web image, or a new illustration.", detail: "Composer can reuse Assets, search Wikimedia when available, draw an exact SVG diagram, or use configured image generation. Imported web images retain source attribution and rights. Generated scenes are disclosed as illustrations and do not become independent source evidence.", control: "roles" },
    { id: "visual-review", name: "Inspect and review", description: "Check the visible image, caption and fit with the article.", detail: "Visual assessment checks image candidates, clarity and article fit. Review checks the composition and factual support. Weak images can be replaced or omitted. A retry can reuse an already generated image rather than pay to generate it again.", control: "roles" },
    { id: "visual-save", name: "Save the current placement", description: "Save reusable assets and version the article’s illustrations.", detail: "The article must still match the version Composer read before its illustrations can be saved. Stale illustrations are hidden. Removing an article illustration leaves the reusable asset in the library; restoring a saved placement requires a matching article version.", control: "system" },
  ],
};

export const ASSET_PHASE: OverviewPhase = {
  id: "assets", name: "Assets and cleanup", trigger: "When media is imported, generated, described, deleted or unlinked; cleanup checks hourly while the app server runs and at startup.", steps: [
    { id: "asset-library", name: "Collect and describe media", description: "Keep source media, web images and generated illustrations in Assets.", detail: "Assets stores origin, description, type, tags, attribution and rights when available. You can edit titles, descriptions, tags and types. Fields you edit are protected from automatic redescription until you hand them back to the analyst.", control: "builtin" },
    { id: "asset-usage", name: "See where an asset is used", description: "Count uses and link to their locations.", detail: "Usage includes current Composer illustrations, article evidence, knowledge thumbnails shared with graph previews, source pages and stakeholder logos. Image details link to each logical destination. Saved historical illustration versions alone do not count as current use.", control: "system" },
    { id: "asset-optimize", name: "Automatically reduce media storage", description: "Keep smaller WebP images, WebM video and Ogg/Opus audio.", detail: "A background worker checks stored media automatically. When conversion produces a verified smaller file, it replaces the larger stored file at the same location so existing links keep working. Images retain their full resolution in storage, with cached smaller display sizes. SVGs and animations retain their format. Failed conversions and files that would grow are left intact. Downloads use the retained optimized file.", control: "system" },
    { id: "asset-trash", name: "Move to Deleted or restore", description: "Hide the asset from the library without breaking its existing uses.", detail: "Delete marks the asset as deleted and moves it to the Deleted tab. Existing uses continue to work. Restore returns it to the active library. Active assets are never eligible for seven-day cleanup.", control: "system" },
    { id: "asset-unlink", name: "Unlink a deleted image", description: "Remove article and stakeholder placements before cleanup.", detail: "For deleted external and generated images, Unlink removes article illustrations, saved illustration versions and stakeholder logo links after confirmation. It leaves the image in Deleted. Restoring the image does not restore its links. Source-owned images use the source-removal flow so their evidence is handled safely.", control: "system" },
    { id: "asset-purge", name: "Permanently delete or expire", description: "Remove unused deleted assets now, or after seven days.", detail: "Permanently delete is only offered in Deleted, and the server refuses assets still in use. Automatic cleanup removes unused assets once seven days have passed since deletion. It removes the asset record and generated content, clears old illustration references and queues owned files for removal. Failed file removals stay queued for retry. Assets still in use are kept.", control: "system" },
  ],
};

export const OTHER_PHASES: OverviewPhase[] = [
  { id: "sourcer", name: "Add External Info", trigger: "When you choose Add External Info in an article or section menu. Section requests focus on that heading and its knowledge.", steps: [
    { id: "sourcer-request", name: "User-preapproved sourcing", description: "Sourcer searches for useful information about the article.", detail: "Your request preapproves outside search and import without the automatic research-permission gate. Sourcer uses the article’s saved knowledge and your optional focus to choose a search. The role has editable instructions, model and effort settings.", control: "roles" },
    { id: "sourcer-import", name: "Save sources and create knowledge", description: "Check excerpts, skip duplicate URLs and add cited claims.", detail: "Automatic checks verify relevant, reliable, verbatim source excerpts. Accepted sources are saved with URLs and passages, then reconciled into new claims and knowledge units under external reference topics. Existing internal knowledge and personal decisions remain protected by Change control.", control: "roles" },
  ] },
  ILLUSTRATION_PHASE,
  ASSET_PHASE,
  { id: "graph", name: "Graph edits and history", trigger: "When you edit graph knowledge or domains, run the Domain Decider, or use graph history.", steps: [
    { id: "graph-manual", name: "Edit and organize the graph", description: "Select knowledge, adjust domains and update relationships.", detail: "Graph actions let you work with selected knowledge and domains. The Domain Decider can review domain assignments using knowledge clusters and connections. Proposed changes go through their validation and approval paths before they affect saved knowledge.", control: "roles" },
    { id: "graph-history", name: "Undo or redo graph changes", description: "Reverse an edit or reapply an undone change.", detail: "Graph history records edits for Undo and Redo. History checks that the saved graph still matches the expected state before applying a reversal, protecting later work from being overwritten. This is separate from permanent asset deletion and Unlink, which cannot be reversed by graph history.", control: "system" },
  ] },
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
