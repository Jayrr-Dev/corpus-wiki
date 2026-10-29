import type { TutorialStep } from "./steps";

export type ModuleTutorial = {
  id: string;
  label: string;
  steps: readonly TutorialStep[];
};

function step(title: string, body: string, hint: string, tourId = "reading-pane"): TutorialStep {
  return { title, body, targetFor: () => ({ tourId, hint }), completedBy: null };
}

const MODULES: Record<string, ModuleTutorial> = {
  pages: {
    id: "pages", label: "Wiki",
    steps: [
      step("Your living knowledge pages", "Pages turn saved knowledge into articles. Home shows featured, recent and related ones.", "Browse an article or use Browse all pages to explore the hierarchy."),
      step("Create a page", "Give it a title. Pick an entity to start with an Overview from its knowledge.", "Choose New page to start.", "new-page"),
      step("Keep pages connected to evidence", "Uploads become knowledge that feeds your articles. Open a page to see its sections and claims.", "Open an article, or visit Upload to add evidence."),
    ],
  },
  page: {
    id: "page", label: "Article",
    steps: [
      step("Read an article and its evidence", "Sections are built from your knowledge. Click a line to see its claims and sources.", "Select a line in the article.", "page-body"),
      step("Update the article", "Article actions update, improve or expand the page. Update takes an optional note.", "Use the article actions beside the heading.", "module-header"),
      step("Work section by section", "A section menu updates or fills that section. Add a section to give the article room to grow.", "Use a section menu or the add-section control.", "page-body"),
    ],
  },
  glossary: {
    id: "glossary", label: "Glossary",
    steps: [
      step("Find a term or a meaning", "Definitions come from your saved knowledge. Type to filter, or search by meaning.", "Enter a term or describe the concept you mean.", "glossary-search"),
      step("Narrow the dictionary", "Categories split acronyms, technical terms and jargon. The alphabet narrows to one letter.", "Choose a category or letter to narrow the definitions."),
      step("Check and maintain definitions", "Numbered references lead to sources. Each menu has evidence, history, edit and delete. Regenerate may replace manual edits.", "Inspect a definition’s references and menu before editing."),
    ],
  },
  graph: {
    id: "graph", label: "Graph",
    steps: [
      step("Explore connected knowledge", "The graph shows saved knowledge and how it connects. Empty? Upload evidence first.", "Explore the graph canvas and select items to inspect them."),
      step("Adjust the graph view", "Search and filters choose what shows. Color, display and force settings change the layout; replay shows it grow.", "Open the graph settings to tune your view."),
      step("Maintain connections", "Graph settings hold tools to link knowledge, describe entities and clean up duplicates.", "Look in graph settings for the maintenance actions."),
    ],
  },
  ask: {
    id: "ask", label: "Ask",
    steps: [
      step("Ask about your knowledge", "Ask questions or request an article from your saved knowledge. Answers link to their evidence.", "Write a request and send it.", "ask-composer"),
      step("Choose context and output", "Narrow the topic, pick a response style, and choose Ask (answers only) or Agent (can also create articles and import links).", "Choose context, response style and mode.", "ask-composer"),
      step("Review actions and keep conversations", "Activity cards show agent work; exception decisions need your confirmation. Chats are saved in this browser. Stopping keeps finished changes.", "Open references and review any confirmation before applying a decision."),
    ],
  },
  upload: {
    id: "upload", label: "Upload",
    steps: [
      step("Add source evidence", "Choose or drop files. Each one gets its own row to follow.", "Drop a file or choose files.", "upload-dropzone"),
      step("Import a link", "Import a source link. It is read and turned into knowledge and article updates.", "Use the link form to add a source URL.", "upload-link"),
      step("Follow the processing workflow", "Recent uploads show progress and failures. Open a source to see what cites it, or retry a failure.", "Check Recent uploads after adding evidence.", "upload-recent"),
    ],
  },
  units: {
    id: "units", label: "Units",
    steps: [
      step("Inspect individual knowledge units", "Units are the claims that build articles. Each row shows content, status and evidence.", "Search the list and open a unit to see its details."),
      step("Filter knowledge precisely", "Internal and External split by origin. Filters narrow kind, status, evidence, domain and more.", "Choose a source origin, then use the available filters.", "units-origin"),
      step("Add and maintain a unit", "New unit adds knowledge directly. A unit’s page holds its history, sources, context and links.", "Use New unit or open an existing row."),
    ],
  },
  unit: {
    id: "unit", label: "Knowledge unit",
    steps: [
      step("Understand the current claim", "The header shows the claim, its kind, status, date and evidence. Actions maintain it.", "Read the claim and its status before making a change."),
      step("Trace revisions and evidence", "History records revisions. Sources lists the passages behind it.", "Review History and Sources to understand where the claim came from."),
      step("Check where it applies", "About lists entities, domains and conditions. Links shows related knowledge.", "Inspect About and Links before reusing the claim in another context."),
    ],
  },
  changes: {
    id: "changes", label: "Changes",
    steps: [
      step("Follow workspace changes", "Uploads, AI work and your edits create change sets: what changed, its status and who proposed it.", "Open a change to inspect the actions it contains."),
      step("Find the change you need", "Filter by status, proposer, type and time. Proposers can be people or AI models.", "Use the filters and table search to narrow the history."),
      step("Inspect before undoing", "A change shows its actions and Undo. Undo keeps the history; later changes may need undoing first.", "Review the change detail before choosing Undo."),
    ],
  },
  change: {
    id: "change", label: "Change detail",
    steps: [
      step("Understand the change set", "The summary shows status, proposer, timing and any linked source or decision.", "Read the change summary first."),
      step("Review the actual actions", "Actions lists each operation and its outcome. Follow links for context.", "Inspect Actions to see the individual changes."),
      step("Reverse with context", "Undo shows when the change can be reversed. History stays; later changes may need undoing first.", "Review the Undo confirmation if you need to reverse this change."),
    ],
  },
  decisions: {
    id: "decisions", label: "Decisions",
    steps: [
      step("Read the decision history", "Approvals, archive and exception decisions, with who made them.", "Search the list and open a decision to inspect its change set."),
      step("Understand the effect", "Source and domain decisions open their change sets. Exception rows open their review and outcome.", "Filter by type or outcome, then open a decision to inspect its context."),
      step("Revisit a decision", "The row menu can reverse a decision. History stays; later changes may need reversing first.", "Read the reversal confirmation before proceeding."),
    ],
  },
  decision: {
    id: "decision", label: "Decision detail",
    steps: [
      step("Trace the decision", "The change set behind the decision: who, status and when.", "Read the decision summary to understand who decided and what happened."),
      step("Inspect the consequences", "Actions lists what the decision did. Linked units and sources give context.", "Review each action and follow its links when needed."),
      step("Understand reversal", "Undo reverses what it can and keeps the history. Later changes can block it.", "Review the Undo confirmation before reversing."),
    ],
  },
  exceptions: {
    id: "exceptions", label: "Exceptions",
    steps: [
      step("Find decisions needing review", "Needs review holds questions waiting for you. Search and filter to focus the queue.", "Choose an item from the inbox.", "exceptions-inbox"),
      step("Compare the proposal with evidence", "An item shows the proposed change and its evidence. Read it before you accept or reject.", "Open an item and inspect the review panel."),
      step("Decide and continue", "Decide, with an optional note. Move with Previous and Next; Answered holds past reviews.", "Review one item at a time, then check Answered for the recorded outcome."),
    ],
  },
  sources: {
    id: "sources", label: "Sources",
    steps: [
      step("Browse the evidence library", "Sources are the files and web pages behind your knowledge, split into Internal and External.", "Search sources and open a file to inspect it."),
      step("Add and inspect a source", "Upload files opens the import screen. A source shows its details, preview, passages and citing knowledge.", "Choose Upload files or open a source row.", "module-header"),
      step("Maintain source history", "Source menus replace, rerun, archive or restore. Archiving or deleting a source removes evidence from its knowledge.", "Review the source state and confirmation before using a lifecycle action."),
    ],
  },
  source: {
    id: "source", label: "Source detail",
    steps: [
      step("Check the original source", "File shows the source date, origin, state and processing progress.", "Inspect the File section and preview."),
      step("Trace knowledge back to passages", "Knowledge lists the units citing this file. Passages holds the extracted evidence.", "Open a knowledge unit or read the extracted passages."),
      step("Manage the source carefully", "The File menu holds source actions. Read each confirmation before you go on.", "Use the File menu when the source needs updating or retiring."),
    ],
  },
  entities: {
    id: "entities", label: "Entities",
    steps: [
      step("Find the things knowledge is about", "Entities are people, projects, teams and other named things, each with its knowledge.", "Search the entity list and open a row."),
      step("Add or maintain an entity", "New entity adds one. Row menus edit or retire it.", "Use New entity or an entity’s menu.", "module-header"),
      step("Check related knowledge", "An entity lists its units. Open one to check its evidence and history.", "Open an entity, then inspect its linked units."),
    ],
  },
  entity: {
    id: "entity", label: "Entity detail",
    steps: [
      step("Identify the entity", "The Entity section tells this one apart from similar names.", "Read the entity details before reusing its knowledge."),
      step("Explore its knowledge", "Units lists its knowledge, each with its own evidence and history.", "Open a linked unit to verify its content and applicability."),
    ],
  },
  domains: {
    id: "domains", label: "Domains",
    steps: [
      step("Browse knowledge by domain", "Domains sort knowledge into a tree. Expand an arrow for subdomains; counts cover the branch.", "Expand a branch or choose a domain to inspect its units."),
      step("Use domain groups", "Tabs group root domains. Subdomains follow their root.", "Choose a group tab, or use the plus button to create a tab.", "domains-groups"),
      step("Maintain the hierarchy", "New domain adds a root. Menus add children, rename or retire.", "Use New domain or a branch’s menu after checking its scope."),
    ],
  },
  workflow: {
    id: "workflow", label: "Workflow",
    steps: [
      step("Understand the workflow views", "Workflow overview shows the whole system. Skill assignments and Skill library hold skills; Pipeline diagrams and AI handoffs are maps.", "Switch among the Workflow tabs.", "workflow-tabs"),
      step("Assign reusable instructions", "Pick a skill for a stage and save. App rules only drops the skill; Reset to default restores it.", "Open Skill assignments and review the capability before changing its skill."),
      step("Create and reuse skills", "New skill makes your own. Duplicate a built-in one to adapt it. Unassign a skill before archiving it.", "Use New skill or open Skill library to inspect existing instructions."),
    ],
  },
  roles: {
    id: "roles", label: "Agent Roles",
    steps: [
      step("Meet the roster", "Each card is one AI role: its job, instructions and model.", "Scan the cards to see who does what."),
      step("Tune a role", "Open a card’s instructions to edit them, and pick its model and effort. Some roles can run in full auto.", "Open a card’s instructions before changing them."),
    ],
  },
  errors: {
    id: "errors", label: "Error log",
    steps: [
      step("See everything that went wrong", "Every error in the app: page crashes, failed actions, background jobs, AI calls and browser errors.", "Scan the newest errors at the top."),
      step("Read the details", "Filter by origin, search messages, and open a row for the full stack trace.", "Select a row to see its details."),
      step("Clear the log", "Clear log removes every entry. New errors keep arriving as they happen.", "Clear the log once you have dealt with what is in it."),
    ],
  },
  settings: {
    id: "settings", label: "Settings",
    steps: [
      step("Find the setting you need", "Tabs split preferences, AI, features, security, agents, usage and costs.", "Choose a settings section.", "settings-tabs"),
      step("Control automatic work", "Features control automatic work like stale-line updates and external knowledge. Intelligence holds the AI models.", "Hover an info icon for a setting’s details."),
      step("Check account and AI activity", "Security changes your password. Usage and costs show AI activity and spend.", "Open the relevant tab to inspect activity or maintain your account."),
    ],
  },
};

/** Resolve only application modules; nested detail routes get their own tour. */
export function getModuleTutorial(pathname: string): ModuleTutorial | null {
  const segments = pathname.split("/").filter(Boolean);
  const [root, detail] = segments;
  if (!root) return MODULES.pages ?? null;
  if (root === "p" && detail) return MODULES.page ?? null;
  if (root === "ask" || root === "chatbot") return MODULES.ask ?? null;
  if (detail) {
    const detailModules: Record<string, string> = { units: "unit", changes: "change", decisions: "decision", sources: "source", entities: "entity" };
    const key = detailModules[root];
    return key ? MODULES[key] ?? null : null;
  }
  return MODULES[root] ?? null;
}
