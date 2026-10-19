// AI FLOW: how the AI roles hand work to each other and what each submits to Change control.
// Traced from the code, not a live run. Role names come from lib/ai/roles.ts (roleName); a step
// whose AI call maps to no role (roleForPurpose returns null) is shown as an unnamed AI step.

export type AiFlowFact = { label: string; text: string };
export type AiFlowNode = {
  id: string; step: string; does: string;
  kind: "role" | "reviewer" | "unnamed" | "system";
  // roleName() id for the box title; otherwise `name`
  roleId?: string; name: string;
  // Role ids whose instructions shape this step (stage skills or fixed role policies)
  roles?: string[];
  receivesShort?: string;
  submits: string[]; exceptions?: string[]; direct?: boolean;
  facts: AiFlowFact[]; instructionsNote?: string;
};
export type AiFlowLane = { id: string; title: string; trigger: string; toChangeControl: boolean; nodes: AiFlowNode[] };
export type PersonStep = { id: string; name: string; does: string; chips?: string[]; tone?: "undo"; facts: AiFlowFact[] };

const APP_MANAGED = "This role uses instructions managed by the app; they cannot be edited in Agent Roles.";
const NO_ROLE = "This AI call is not attributed to a named role, so it has no role instructions. It follows the app’s built-in prompt.";

const FLOW_SOURCE_LANES: AiFlowLane[] = [
  {
    id: "save", title: "Upload · save the evidence", trigger: "Starts when you upload a file.", toChangeControl: true,
    nodes: [
      { id: "media", step: "Convert", kind: "role", roleId: "media_analyst", name: "Media analyst", does: "Describes images and videos so they can be read as text.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "Image bytes, or video frames plus a transcript, while the file is converted." },
          { label: "Hands on", text: "A text description that becomes source passages for the Reconciler." },
          { label: "Submits", text: "Nothing to Change control. The description is part of the source text." },
        ], instructionsNote: APP_MANAGED },
      { id: "reconciler", step: "Reconcile", kind: "role", roleId: "reconciler", name: "Reconciler", roles: ["extract_knowledge", "identify_entities", "link_knowledge", "organize_topics", "define_concepts"], receivesShort: "passages",
        does: "Reads new passages against saved knowledge in one request guided by five roles.",
        submits: ["add_claim", "revise_claim", "retire_claim", "set_epistemic_status", "link", "create_entity"], exceptions: ["deletion"],
        facts: [
          { label: "Receives", text: "The upload’s source passages and the related saved knowledge (claims, entities, topics)." },
          { label: "Guided by", text: "The Extractor, Entity analyst, Linker, Organizer and Definer instructions, combined in one model request. Topic filing is left to the placement step after the save." },
          { label: "Submits", text: "One ChangeSet of claims, revisions, links and new entities, checked and committed by Change control." },
          { label: "You decide", text: "When it wants to retire a claim (deletion), when two same-date sources disagree, or when it would overwrite one of your decisions." },
        ] },
    ],
  },
  {
    id: "clean", title: "Upload · clean and file the knowledge", trigger: "Duplicates, entity clean-up, placement, hierarchy and definitions run before one index. Descriptions, profiles and glossary run after the articles and add no claims.", toChangeControl: true,
    nodes: [
      { id: "embeddings", step: "Index", kind: "system", name: "Claim vectors", does: "Indexes the new claims by meaning for matching.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "The cleaned claims and the definitions added for this upload." },
          { label: "Hands on", text: "Vectors used by the Article reviewer and the Reviewer to find related knowledge. The Duplicate reviewer indexes any claims it still needs while comparing them." },
          { label: "Submits", text: "Nothing. Vectors are saved directly." },
        ] },
      { id: "deduplicator", step: "Duplicates", kind: "role", roleId: "deduplicator", name: "Duplicate reviewer", does: "Merges repeats of claims this upload added or revised.", submits: ["revise_claim", "merge_duplicates"], exceptions: ["deletion"], receivesShort: "similar claims",
        facts: [
          { label: "Receives", text: "Clusters of similar claims, found with the vectors." },
          { label: "Submits", text: "One ChangeSet per cluster: a revised claim and a merge of the repeats." },
          { label: "You decide", text: "Near-identical, confident merges apply on their own. Any other merge waits in Exceptions as a deletion." },
        ], instructionsNote: APP_MANAGED },
      { id: "tidy", step: "Tidy", kind: "unnamed", name: "Entity clean-up", does: "Merges duplicate entities and retires unused ones.", submits: ["merge_entity", "retire_entity"],
        facts: [
          { label: "Receives", text: "The entities this upload touched." },
          { label: "Submits", text: "A ChangeSet of entity merges and retirements. An entity is retired only when nothing uses it, so these apply without an Exception." },
        ], instructionsNote: NO_ROLE },
      { id: "place", step: "Assign domains", kind: "role", roleId: "domain_decider", roles: ["domain_decider"], name: "Domain Decider", does: "Assigns incoming knowledge using source context, semantic neighbors and graph connections, then reviews each group before saving.", submits: ["create_domain", "place_claim"], exceptions: ["root_domain_approval"],
        facts: [
          { label: "Receives", text: "Unassigned incoming claims, source context, the whole-file plan, saved domain examples, embedding neighbors and typed connections." },
          { label: "Submits", text: "New topics and claim placements under the upload’s event." },
          { label: "You decide", text: "A new root topic waits for your approval in Exceptions. The rest of the upload pauses until you answer." },
        ] },
      { id: "describe", step: "Describe", kind: "role", roleId: "identify_entities", name: "Entity analyst", roles: ["identify_entities"], does: "Writes short descriptions of new entities.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "New entities and the claims about them." },
          { label: "Hands on", text: "Entity descriptions on entity pages. The articles are already written." },
          { label: "Submits", text: "Nothing to Change control. Descriptions are saved directly on the entity." },
        ] },
      { id: "profiles", step: "Profiles", kind: "unnamed", name: "Stakeholder cards", does: "Builds stakeholder cards and, if allowed, looks each one up on the web.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "Evidence about each touched entity, your organization, and the kinds already in use." },
          { label: "Hands on", text: "Stakeholder cards. With outside knowledge allowed in Settings, a web lookup adds a matched profile, official site and logo." },
          { label: "Submits", text: "Nothing to Change control, and no approval. Your contacts and hidden cards are never overwritten. Saving a stakeholder’s web page as knowledge goes through Outside research." },
        ], instructionsNote: NO_ROLE },
      { id: "hierarchy", step: "Hierarchy", kind: "system", name: "Context hierarchy", does: "Files topics under their entity context. No AI.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "Page candidates for this upload." },
          { label: "Submits", text: "Nothing. Topic contexts are updated directly." },
        ] },
      { id: "dictionary", step: "Glossary", kind: "role", roleId: "dictionary_editor", name: "Dictionary editor", does: "Writes cited glossary entries from live claims.", submits: [], direct: true,
        facts: [
          { label: "Receives", text: "Live claims with their source evidence, in batches." },
          { label: "Hands on", text: "Glossary entries with citations, then indexed for search." },
          { label: "Submits", text: "Nothing to Change control. Entries are saved to the glossary directly." },
        ], instructionsNote: APP_MANAGED },
    ],
  },
  {
    id: "articles", title: "Upload · write the articles", trigger: "Planner, Article reviewer, Writer and Reviewer write the articles once, after definitions are saved and indexed.", toChangeControl: true,
    nodes: [
      { id: "definer", step: "Expand", kind: "role", roleId: "define_concepts", name: "Definer", roles: ["define_concepts"], does: "Defines terms for key entities from their evidence.", submits: ["create_entity", "add_claim"],
        facts: [
          { label: "Receives", text: "For each company, organization, project, person, team or product: its claims, source passages, entities, topics and definitions." },
          { label: "Hands on", text: "Up to 12 defined terms per entity, saved before the index and the article pass." },
          { label: "Submits", text: "One ChangeSet per entity, committed straight away and reversible in Changes." },
        ] },
      { id: "planner", step: "Plan", kind: "role", roleId: "plan_articles", name: "Planner", roles: ["plan_articles"], receivesShort: "claims", does: "Outlines pages and proposes new or updated articles.", submits: ["rename_page", "create_section", "retire_section"],
        facts: [
          { label: "Receives", text: "The upload’s claims, the article charter, the index of existing articles and the entities." },
          { label: "Hands on", text: "Each proposed new article goes to the Article reviewer. An update to an existing article skips review and gets new sections." },
          { label: "Submits", text: "Outline changes to existing entity pages. Pages with a person’s sections are left alone." },
        ] },
      { id: "article_reviewer", step: "Independent check", kind: "reviewer", roleId: "article_reviewer", name: "Article reviewer", roles: ["article_reviewer"], receivesShort: "new-article proposal", does: "Approves, redirects or rejects each proposed new article.", submits: ["create_page", "create_section"],
        facts: [
          { label: "Receives", text: "In a fresh context: the charter, the article index, the proposal and related claims found by meaning." },
          { label: "Decides", text: "approve → create_page; update_existing → new sections on that article; section_of → one new section; reject → nothing is written and the claims stay in the store." },
          { label: "Submits", text: "One ChangeSet for the verdict, committed straight away. Every verdict is recorded." },
        ] },
      { id: "writer", step: "Write", kind: "role", roleId: "write_articles", name: "Writer", roles: ["write_articles"], receivesShort: "approved outline", does: "Writes each affected section from its claims and citations.", submits: ["write_line", "revise_line", "retire_line"], exceptions: ["update_request"],
        facts: [
          { label: "Receives", text: "One section at a time: its assigned claims, current lines, flagged lines and uncovered claims." },
          { label: "Checked by", text: "The Reviewer's model reads each new or rewritten line beside only the claims it cites, and gives each objection a second look. Lines that say more than their claims go back once for a fix; any still unsupported are not saved." },
          { label: "Hands on", text: "Rebuilt sections, passed to the Reviewer." },
          { label: "Submits", text: "Line-by-line ChangeSets." },
          { label: "You decide", text: "A change to a line you wrote is held in Exceptions as an update request." },
        ] },
      { id: "reviewer", step: "Independent check", kind: "reviewer", roleId: "reviewer", name: "Reviewer", roles: ["reviewer"], receivesShort: "rebuilt sections", does: "Edits rebuilt pages for quality and raises what it cannot settle.", submits: ["revise_line", "rename_section", "retire_section", "review_page"], exceptions: ["domain_tree_review"],
        facts: [
          { label: "Receives", text: "A snapshot of each rebuilt page, related claims found by meaning, and repairs the app already planned." },
          { label: "Submits", text: "Up to 24 edits per page as one ChangeSet, applied automatically and reversible in Changes." },
          { label: "You decide", text: "Up to 6 findings per page become review_page Exceptions. Accepting one acknowledges it; it changes no content." },
        ] },
    ],
  },
  {
    id: "research", title: "Outside research · two independent approvals", trigger: "Only with outside knowledge allowed in Settings: when you create, improve or force-create a section, or save a stakeholder’s web page. Never during an upload.", toChangeControl: true,
    nodes: [
      { id: "researcher-search", step: "Propose", kind: "role", roleId: "researcher", name: "Researcher", roles: ["researcher"], does: "Names a specific gap and a search query, or says none is needed.", submits: [],
        facts: [
          { label: "Receives", text: "Project context: organization, article, section, source titles, project facts and existing knowledge." },
          { label: "Hands on", text: "A proposal (gap, justification, query) to the Reviewer. It never approves its own proposal." },
          { label: "Submits", text: "Nothing yet. With no project facts, the search is rejected without any AI call." },
        ] },
      { id: "reviewer-search", step: "Approve search", kind: "reviewer", roleId: "reviewer", name: "Reviewer", roles: ["reviewer"], receivesShort: "proposal", does: "Decides in a fresh context whether the project needs this research.", submits: ["source_review"],
        facts: [
          { label: "Receives", text: "Only its own policy, the project context and the proposal." },
          { label: "Hands on", text: "Approval authorizes one web search. A rejection stops here." },
          { label: "Submits", text: "Every decision is recorded as a source_review action with both roles’ models and instructions. You can undo it in Changes." },
        ] },
      { id: "researcher-source", step: "Select excerpts", kind: "role", roleId: "researcher", name: "Researcher", roles: ["researcher"], receivesShort: "approved query → web pages", does: "Justifies each found page and picks verbatim excerpts.", submits: [],
        facts: [
          { label: "Receives", text: "The approved research and each fetched page (title, URL, text)." },
          { label: "Hands on", text: "Excerpts to the Reviewer. Excerpts that are not verbatim in the page, or are too short, are dropped by the app." },
        ] },
      { id: "reviewer-source", step: "Approve source", kind: "reviewer", roleId: "reviewer", name: "Reviewer", roles: ["reviewer"], receivesShort: "excerpts", does: "Admits only the excerpts that answer the gap.", submits: ["source_review"],
        facts: [
          { label: "Receives", text: "The source, its proposed excerpts and the project context." },
          { label: "Hands on", text: "The approved excerpts, saved as an outside source." },
          { label: "Submits", text: "A source_review action. Undoing an approval also archives the source." },
        ] },
      { id: "reconciler-external", step: "Scoped reconcile", kind: "role", roleId: "reconciler", name: "Reconciler", roles: ["extract_knowledge", "identify_entities", "link_knowledge", "organize_topics", "define_concepts"], receivesShort: "approved excerpts", does: "Turns approved excerpts into claims, checked by the Duplicate reviewer.", submits: ["add_claim", "create_entity"],
        facts: [
          { label: "Receives", text: "Only the approved excerpts, scoped to the article and section that asked." },
          { label: "Hands on", text: "New claims to the Writer, which rebuilds the section with citations." },
          { label: "Submits", text: "Only new claims in existing reference topics and the entities they use. It never revises saved claims or creates topics." },
        ] },
    ],
  },
  {
    id: "request", title: "On request", trigger: "Domain review and linking run on request. The Curator also runs after the glossary.", toChangeControl: true,
    nodes: [
      { id: "domain_decider", step: "Update domains", kind: "role", roleId: "domain_decider", name: "Domain Decider", roles: ["domain_decider"], does: "Uses embeddings, graph connections and saved knowledge to organize domains.", submits: ["update_domain"], exceptions: ["domain_tree_review"],
        facts: [
            { label: "Receives", text: "One domain at a time, starting with the largest ungrouped clusters. Compares alternative groups from embeddings and typed connections, using full claims, children and nearby domains." },
          { label: "Submits", text: "A separate atomic update for each domain: creates subdomains, moves domains or claim groups, renames topics and retires empty leaves. Re-ranks fresh evidence after each review and checks changed domains again." },
            { label: "Quality check", text: "A separate AI review grades grouping, placement and simplicity before saving. Up to three proposal attempts address its findings; failed reviews leave domains unchanged." },
            { label: "You decide", text: "Choose one domain or review all candidates. Stop after the current domain, rerun with guidance, or undo each update from the graph or Changes. Uncertain plans wait in Exceptions." },
        ] },
      { id: "domain_steward", step: "Domain review", kind: "role", roleId: "domain_steward", name: "Domain steward", roles: ["domain_steward"], does: "Checks the topic tree and proposes one useful change.", submits: ["update_domain"], exceptions: ["domain_tree_review"],
        facts: [
          { label: "Receives", text: "The complete topic hierarchy and its saved claims." },
          { label: "Submits", text: "At most one update_domain action per review: rename a topic, merge two equivalent topics, or ask you to inspect one." },
          { label: "You decide", text: "An inspect question, or any change it is not confident about, waits in Exceptions." },
        ] },
      { id: "curator", step: "Curate pages", kind: "role", roleId: "curator", name: "Curator", roles: ["curator"], does: "Keeps the page tree clean: merges repeated pages, files pages under the right parent, fixes titles and types.", submits: ["update_page"], exceptions: ["page_structure_review"],
        facts: [
          { label: "Receives", text: "Every page with the claims it cites, and the pages the app flagged by comparing those claims: duplicates, pages inside other pages, stubs, misplaced pages and look-alike titles." },
          { label: "Submits", text: "One update_page action per change: merge a page into another (its unique claims become a section there), move it, rename it, set its type and scope, or create a placeholder page and file pages under it." },
          { label: "Hands on", text: "Up to five pages per run to another role: the Reviewer polishes or trims a page, the Planner adds stored knowledge it is missing, the Researcher builds out a missing section (from the web only when Settings allow it). Each works through its own undoable ChangeSets." },
          { label: "You decide", text: "Moves, merges that bring claims over, and anything it is not confident about wait in Exceptions. A confident rename, type, or merge of a page that adds nothing applies at once and can be undone in Changes." },
          { label: "When it runs", text: "On its own as the last step of every upload, and from the Pages sidebar. After it, and after you accept one of its changes, the Planner turns any organization page that repeats the pages under it into a short overview." },
        ] },
      { id: "linker", step: "Link existing", kind: "role", roleId: "link_knowledge", name: "Linker", roles: ["link_knowledge"], does: "Links saved claims that are related.", submits: ["link"],
        facts: [
          { label: "Receives", text: "A batch of saved claims." },
          { label: "Submits", text: "The links as one AI ChangeSet." },
        ] },
    ],
  },
];

// Keep the role catalogue grouped in the same phases as the upload runner.
const uploadNode = (id: string) => FLOW_SOURCE_LANES.flatMap((lane) => lane.nodes).find((node) => node.id === id)!;
export const AI_FLOW_LANES: AiFlowLane[] = [
  { id: "sourcer", title: "User-requested external information", trigger: "Add External Info in an article menu; search and import are preapproved by the user.", toChangeControl: false, nodes: [
    { id: "sourcer", step: "Source", kind: "role", roleId: "sourcer", roles: ["sourcer"], name: "Sourcer", does: "Finds external sources and turns checked excerpts into cited knowledge.", submits: [], direct: true, facts: [
      { label: "Starts", text: "You choose Add External Info and optionally describe what to find. This directly authorizes search and import without another research-permission gate." },
      { label: "Checks", text: "Skips saved URLs and checks source reliability and exact excerpt support automatically." },
      { label: "Hands on", text: "Saves sources and their URLs, then sends approved evidence through external reconciliation to create new claims and knowledge units in reference topics. Existing internal claims are not overwritten." },
    ] },
  ] },
  FLOW_SOURCE_LANES[0]!,
  { id: "clean", title: "Upload · clean, file and define", trigger: "Runs after saving and before the articles.", toChangeControl: true, nodes: ["deduplicator", "tidy", "place", "hierarchy", "definer", "embeddings"].map(uploadNode) },
  { id: "articles", title: "Upload · write the articles", trigger: "Runs once after definitions are indexed.", toChangeControl: true, nodes: ["planner", "article_reviewer", "writer", "reviewer"].map(uploadNode) },
  { id: "enrichment", title: "Upload · background finish", trigger: "After the articles are written. Descriptions, profiles and the glossary add no claims. The Curator finishes the run.", toChangeControl: true, nodes: ["describe", "profiles", "dictionary"].map(uploadNode) },
  FLOW_SOURCE_LANES[3]!,
  FLOW_SOURCE_LANES[4]!,
  { id: "illustrations", title: "Article illustrations and reusable assets", trigger: "Automatic article assessment or a manual illustration request; separate from upload evidence.", toChangeControl: false, nodes: [
    { id: "composer", step: "Illustrate", kind: "role", roleId: "composer", roles: ["composer"], name: "Composer", does: "Chooses useful library images, verified web pictures or new illustrations.", submits: [], direct: true, facts: [
      { label: "Receives", text: "The current article, cited evidence, available assets, existing illustrations and any section replacement request." },
      { label: "Checks", text: "Inspects visible candidates and captions, reviews support and article fit, and can omit weak images. Keeps at most three article illustrations." },
      { label: "Saves", text: "Versioned illustrations only if the article still matches. Imported and generated images become reusable Assets with provenance. Generated scenes are disclosed, not admitted as source evidence." },
    ] },
    { id: "asset-lifecycle", step: "Manage assets", kind: "system", name: "Asset lifecycle", does: "Tracks usage, Deleted, Unlink and permanent cleanup.", submits: [], direct: true, facts: [
      { label: "Usage", text: "Links each image to its article, source, knowledge and stakeholder destinations; graph thumbnails share their knowledge destination." },
      { label: "Deleted only", text: "Delete keeps existing uses intact. Unlink removes a deleted library image from articles, saved illustration versions and stakeholder logos. Source-owned images use source removal." },
      { label: "Cleanup", text: "Unused deleted assets expire after seven days, or can be permanently deleted immediately. Used assets are protected. The app checks hourly while running and at startup; failed file removal is retried." },
    ] },
  ] },
];

export const CHANGE_CONTROL = {
  id: "change-control", name: "Change control",
  steps: [
    "A role submits a ChangeSet: ordered, typed actions with their sources.",
    "The judge checks each action against saved knowledge.",
    "Safe actions apply on their own.",
    "Risky actions are held as Exceptions for you.",
    "Applied ChangeSets can be undone in Changes.",
  ],
  facts: [
    { label: "What a ChangeSet is", text: "One proposal from one actor (AI or person): a summary, the model and role attribution, token use, and ordered actions such as add_claim, create_page or write_line." },
    { label: "What the judge checks", text: "It rejects actions on missing or retired targets, unknown entities or topics, and sources older than the claim’s current one, plus page, line and link checks." },
    { label: "What needs you", text: "Retiring or merging knowledge (deletion), a new root topic, changing a line you wrote, overwriting one of your decisions, two same-date sources that disagree, and Reviewer or Domain steward findings." },
    { label: "Undo", text: "Undo replays a ChangeSet’s actions backwards and closes its open Exceptions. It refuses when a later change touched the same knowledge." },
  ],
};


export const PERSON_STEPS: PersonStep[] = [
  { id: "exceptions", name: "Exceptions", does: "Approve or reject held actions. An upload waits on a new root topic.", chips: ["deletion", "root_domain_approval", "update_request", "decision_conflict", "source_tie", "domain_tree_review", "page_structure_review"],
    facts: [
      { label: "What arrives here", text: "Actions Change control holds instead of applying: deletions and merges, new root topics, edits to lines you wrote, overwrites of your decisions, source ties, and findings from the Reviewer and Domain steward." },
      { label: "What waits", text: "A new root topic pauses the upload until you answer. Other Exceptions leave the rest of the run going." },
      { label: "Not here", text: "Outside research is approved by the Reviewer alone, and stakeholder cards are saved without approval. You can undo both." },
    ] },
  { id: "changes", name: "Changes", tone: "undo", does: "Undo any applied ChangeSet, including outside-source decisions.",
    facts: [
      { label: "What you can do", text: "See every applied ChangeSet with who proposed it (AI role or person) and undo it. Undoing an approved outside source also archives it." },
    ] },
  { id: "start", name: "You start runs", tone: "undo", does: "Upload files, build or improve sections, run a domain review, refresh stakeholders.",
    facts: [
      { label: "What you start", text: "Uploads (lanes 1–3), section work that may call Outside research, and the on-request roles (lane 5). You also edit role instructions in Agent Roles." },
    ] },
];

export const ACTION_HINTS: Record<string, string> = {
  add_claim: "Add a cited claim", revise_claim: "Revise a saved claim", retire_claim: "Retire a claim (held for you)",
  set_epistemic_status: "Mark how certain a claim is", link: "Link two related claims", create_entity: "Create an entity",
  merge_duplicates: "Merge repeated claims", merge_entity: "Merge duplicate entities", retire_entity: "Retire an unused entity", retype_entity: "Move an entity to the type that fits",
  create_domain: "Create a topic", place_claim: "File a claim under a topic", update_domain: "Rename, merge or inspect a topic",
  rename_page: "Rename a page", create_page: "Create a new article", create_section: "Add a section", retire_section: "Remove a section", rename_section: "Rename a section",
  write_line: "Write a new line", revise_line: "Revise a line", retire_line: "Remove a line", review_page: "A page finding for you to decide",
  source_review: "Recorded research decision, undoable in Changes",
  deletion: "Exception: the AI wants to retire or merge knowledge", root_domain_approval: "Exception: a new root topic; the upload waits",
  update_request: "Exception: a change to a line you wrote", decision_conflict: "Exception: would overwrite one of your decisions",
  source_tie: "Exception: two same-date sources disagree", domain_tree_review: "Exception: a Reviewer or Domain steward finding",
  update_page: "Merge, move, rename or type a page", page_structure_review: "Exception: a Curator change to the page tree",
};
