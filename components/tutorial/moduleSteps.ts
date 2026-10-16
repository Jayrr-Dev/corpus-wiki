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
    id: "pages", label: "Pages",
    steps: [
      step("Your living knowledge pages", "Pages turn saved knowledge into articles. The home view highlights featured, recent, and related articles from your collection.", "Browse an article or use Browse all pages to explore the hierarchy."),
      step("Create a page", "Give a page a title and optionally choose an entity. With an entity, the page starts with an Overview written from that entity’s knowledge units.", "Choose New page to start.", "new-page"),
      step("Keep pages connected to evidence", "Uploads become knowledge units that can inform your articles. Open a page to inspect its sections, supporting claims, and update controls.", "Open an article, or visit Upload to add evidence."),
    ],
  },
  page: {
    id: "page", label: "Article",
    steps: [
      step("Read an article and its evidence", "An article is organized into sections built from your knowledge. Click a line to inspect the claims and sources behind it.", "Select a line in the article.", "page-body"),
      step("Update the article", "Article actions can update, improve, or expand the page. Update accepts a note to guide what should change.", "Use the article actions beside the heading.", "module-header"),
      step("Work section by section", "Section menus let you request a focused update or create content for that section. Adding a section gives the article a new place to grow.", "Use a section menu or the add-section control.", "page-body"),
    ],
  },
  glossary: {
    id: "glossary", label: "Glossary",
    steps: [
      step("Find a term or a meaning", "Definitions are generated from your saved knowledge. Typing filters words; Search by meaning finds terms matching a description.", "Enter a term or describe the concept you mean.", "glossary-search"),
      step("Narrow the dictionary", "Category buttons separate acronyms, technical terms, jargon, and other terms. The alphabet limits the list to one initial.", "Choose a category or letter to narrow the definitions."),
      step("Check and maintain definitions", "Numbered references lead to sources. Each definition menu offers evidence and history, editing, and deletion. Regenerate rebuilds definitions and may replace manual edits.", "Inspect a definition’s references and menu before editing."),
    ],
  },
  graph: {
    id: "graph", label: "Graph",
    steps: [
      step("Explore connected knowledge", "The graph visualizes saved knowledge and its relationships. Upload evidence first if the graph is empty.", "Explore the graph canvas and select items to inspect them."),
      step("Adjust the graph view", "Search and filters control visible units, entities, pages, domains, orphans, and related links. Color, display, and force settings adjust the layout; replay animates the graph’s growth.", "Open the graph settings to tune your view."),
      step("Maintain connections", "The settings panel includes tools to link existing knowledge, describe entities, and clean up duplicates. Review each tool before starting its operation.", "Look in graph settings for the maintenance actions."),
    ],
  },
  ask: {
    id: "ask", label: "Ask",
    steps: [
      step("Ask about your knowledge", "Ask questions or request an article using the saved knowledge in your workspace. Answers can include references you can open to check the evidence.", "Write a request and send it.", "ask-composer"),
      step("Choose context and output", "The topic picker narrows context to an entity. The output picker changes the response style. Agent mode can create articles and import source links on request.", "Choose context and response style, then decide whether to enable Agent mode.", "ask-composer"),
      step("Review actions and keep conversations", "Activity cards show agent work; exception decisions require your confirmation. Chat history is saved in this browser for your account. Stopping a response leaves completed changes saved.", "Open references and review any confirmation before applying a decision."),
    ],
  },
  upload: {
    id: "upload", label: "Upload",
    steps: [
      step("Add source evidence", "Choose files or drop them here. Each chosen file gets its own upload row so you can follow its progress.", "Drop a file or choose files.", "upload-dropzone"),
      step("Import a link", "You can also import supported source links. The system reads source content and processes it into knowledge and article updates.", "Use the link form to add a source URL.", "upload-link"),
      step("Follow the processing workflow", "Recent uploads show processing progress and failures. Open a source to inspect its content and the knowledge that cites it; retry failed processing when available.", "Check Recent uploads after adding evidence.", "upload-recent"),
    ],
  },
  units: {
    id: "units", label: "Units",
    steps: [
      step("Inspect individual knowledge units", "Units are the claims and other knowledge used to build articles. Each row shows its content, status, and evidence state.", "Search the list and open a unit to see its details."),
      step("Filter knowledge precisely", "Internal and External separate source origins. Filters narrow kind, status, evidence, domain, entity, applicability, and whether units are current or retired.", "Choose a source origin, then use the available filters.", "units-origin"),
      step("Add and maintain a unit", "New unit adds knowledge directly. A unit’s detail page holds its revision history, supporting sources, context, and links to other units.", "Use New unit or open an existing row."),
    ],
  },
  unit: {
    id: "unit", label: "Knowledge unit",
    steps: [
      step("Understand the current claim", "The header shows current content, kind, epistemic status, validity date, and evidence state. Action buttons let you maintain the unit.", "Read the claim and its status before making a change."),
      step("Trace revisions and evidence", "History records revisions. Sources lists the cited passages behind this knowledge so you can check the original evidence.", "Review History and Sources to understand where the claim came from."),
      step("Check where it applies", "About lists linked entities, domains, applicability, and conditions. Context can be edited when available; Links shows relationships to other knowledge.", "Inspect About and Links before reusing the claim in another context."),
    ],
  },
  changes: {
    id: "changes", label: "Changes",
    steps: [
      step("Follow workspace changes", "Uploads, AI operations, and manual edits create change sets. The list shows what changed, its status, and who proposed it.", "Open a change to inspect the actions it contains."),
      step("Find the change you need", "Filters narrow status, proposer, type, and time. Proposers can be people or particular AI models.", "Use the filters and table search to narrow the history."),
      step("Inspect before undoing", "A change detail shows action results and available undo controls. Reversal keeps the historical record and may require later changes to be undone first.", "Review the change detail before choosing Undo."),
    ],
  },
  change: {
    id: "change", label: "Change detail",
    steps: [
      step("Understand the change set", "The summary records the status, proposer, timing, and any linked source or decision information.", "Read the change summary first."),
      step("Review the actual actions", "Actions list the operations contained in this change set and their outcomes. Follow linked knowledge or sources for more context.", "Inspect Actions to see the individual changes."),
      step("Reverse with context", "Undo is available when the change can be reversed. History is retained, and dependent later changes may have to be undone first.", "Review the Undo confirmation if you need to reverse this change."),
    ],
  },
  decisions: {
    id: "decisions", label: "Decisions",
    steps: [
      step("Read the decision history", "Approvals, archive decisions, and exception decisions appear here with their summaries and attribution.", "Search the list and open a decision to inspect its change set."),
      step("Understand the effect", "Source and domain decisions open their underlying change sets and actions. Exception rows open the exception review with its evidence and recorded outcome.", "Filter by type or outcome, then open a decision to inspect its context."),
      step("Revisit a decision", "The row menu can offer reversal. Reversing affects the applied changes in that change set and preserves the history; later changes may need reversal first.", "Read the reversal confirmation before proceeding."),
    ],
  },
  decision: {
    id: "decision", label: "Decision detail",
    steps: [
      step("Trace the decision", "This view shows the change set behind the decision, including its attribution, status, and timing.", "Read the decision summary to understand who decided and what happened."),
      step("Inspect the consequences", "The Actions section lists the operations associated with the decision. Linked units and sources provide the supporting context.", "Review each action and follow its links when needed."),
      step("Understand reversal", "Available undo controls reverse applicable changes while keeping the audit history. Dependent later changes can prevent immediate reversal.", "Review the Undo confirmation before reversing."),
    ],
  },
  exceptions: {
    id: "exceptions", label: "Exceptions",
    steps: [
      step("Find decisions needing review", "Needs review contains open questions held for your decision. Search evidence, domains, or notes and filter category or order to focus the queue.", "Choose an item from the inbox.", "exceptions-inbox"),
      step("Compare the proposal with evidence", "Opening an item shows the proposed change, supporting evidence, and decision controls. Read that context before accepting or rejecting.", "Open an item and inspect the review panel."),
      step("Decide and continue", "Apply your decision with an optional note. Previous item and Next item move through the queue; Answered lets you revisit completed reviews.", "Review one item at a time, then check Answered for the recorded outcome."),
    ],
  },
  sources: {
    id: "sources", label: "Sources",
    steps: [
      step("Browse the evidence library", "Sources are the files and web material behind your knowledge. Internal and External separate uploaded material from external sources.", "Search sources and open a file to inspect it."),
      step("Add and inspect a source", "Upload files opens the import screen. A source detail includes metadata, preview, passages, and citing knowledge. External sources have independent approval and review history controls.", "Choose Upload files or open a source row.", "module-header"),
      step("Maintain source history", "Source menus offer lifecycle operations such as replacement, rerun, archive, or restore when available. Archiving or deleting a source changes the evidence available to its knowledge.", "Review the source state and confirmation before using a lifecycle action."),
    ],
  },
  source: {
    id: "source", label: "Source detail",
    steps: [
      step("Check the original source", "File metadata records source date, origin, state, and replacement links where available. Internal sources can also show upload processing progress.", "Inspect the File section and preview."),
      step("Trace knowledge back to passages", "Knowledge from this file lists current units citing the source. Passages contains extracted source material used as evidence.", "Open a knowledge unit or read the extracted passages."),
      step("Manage the source carefully", "The File menu contains the available source operations. Read each confirmation to understand its effect on the source and connected knowledge.", "Use the File menu when the source needs updating or retiring."),
    ],
  },
  entities: {
    id: "entities", label: "Entities",
    steps: [
      step("Find the things knowledge is about", "Entities represent people, projects, teams, and other named things. Their linked units collect the knowledge associated with them.", "Search the entity list and open a row."),
      step("Add or maintain an entity", "New entity records a name, type, and identifying details. Row menus offer the available editing and lifecycle actions.", "Use New entity or an entity’s menu.", "module-header"),
      step("Check related knowledge", "An entity detail lists the units attached to it. Open a unit to inspect evidence, applicability, and revision history.", "Open an entity, then inspect its linked units."),
    ],
  },
  entity: {
    id: "entity", label: "Entity detail",
    steps: [
      step("Identify the entity", "The Entity section records the named thing and its identifying information. This context helps distinguish similar names.", "Read the entity details before reusing its knowledge."),
      step("Explore its knowledge", "Units lists knowledge attached to this entity. Each unit has its own supporting evidence and history.", "Open a linked unit to verify its content and applicability."),
    ],
  },
  domains: {
    id: "domains", label: "Domains",
    steps: [
      step("Browse knowledge by domain", "Domains organize knowledge into a hierarchy. Expand an arrow to reveal subdomains; counts include current units in that branch.", "Expand a branch or choose a domain to inspect its units."),
      step("Use domain groups", "Tabs group root domains and explain what belongs in each group. Subdomains follow their root; tab editing controls group descriptions and membership.", "Choose a group tab, or use the plus button to create a tab.", "domains-groups"),
      step("Maintain the hierarchy", "New domain adds a root to the current group. Domain menus support available operations such as adding children, renaming, and retiring.", "Use New domain or a branch’s menu after checking its scope."),
    ],
  },
  skills: {
    id: "skills", label: "Workflow",
    steps: [
      step("Understand the workflow views", "Stage assignments chooses instructions for each AI stage. Skill library holds reusable instructions; Flows and Roles explain how the work is organized.", "Switch among the Workflow tabs.", "workflow-tabs"),
      step("Assign instructions to a stage", "Choose a skill for a stage and save the change. App rules only removes the added skill instructions; Reset to default restores the default assignment.", "Review a stage’s description before changing its assigned skill."),
      step("Create and reuse skills", "New skill creates custom instructions. Duplicate a built-in skill to adapt it; changes apply to future runs. Assigned skills must be unassigned before archiving.", "Use New skill or open Skill library to inspect existing instructions."),
    ],
  },
  settings: {
    id: "settings", label: "Settings",
    steps: [
      step("Find the setting you need", "Settings separates workspace preferences, AI configuration, features, security, usage, and costs into tabs.", "Choose a settings section.", "settings-tabs"),
      step("Control automatic work", "Workspace and feature settings control options such as stale-knowledge updates and external knowledge. Intelligence contains the available AI model choices.", "Read each setting’s explanation before changing its value."),
      step("Check account and AI activity", "Security lets you update your password. Usage and costs help you review AI activity, token consumption, and model costs.", "Open the relevant tab to inspect activity or maintain your account."),
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
