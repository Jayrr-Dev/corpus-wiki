import type { Enums } from "@/lib/database/types";
import type { ChangeContext } from "@/lib/queries/changeContexts";

// =====================================================================
// DESCRIBE A CHANGE SET: what kind of change it is, which domain and
// section it touched, and a short summary, read from its actions (as the
// database's change_set_contexts sums them up), not from the summary text.
// Pure, so the table and tests share it.
// =====================================================================

type ActionType = Enums<"action_type">;

export type ChangeType =
  | "glossary"
  | "source_lifecycle"
  | "source_review"
  | "line_rewrite"
  | "line_add"
  | "line_remove"
  | "line_move"
  | "line_edit"
  | "article_new"
  | "article_update"
  | "merge"
  | "links"
  | "claim_new"
  | "claim_edit"
  | "claim_retire"
  | "knowledge"
  | "catalog"
  | "other";

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  glossary: "Glossary",
  source_lifecycle: "Archive Decision",
  source_review: "Approver decision",
  line_rewrite: "Rewrite",
  line_add: "New line",
  line_remove: "Removal",
  line_move: "Reorder",
  line_edit: "Line edits",
  article_new: "New article",
  article_update: "Article update",
  merge: "Merge",
  links: "Links",
  claim_new: "New claim",
  claim_edit: "Claim edit",
  claim_retire: "Claim removal",
  knowledge: "Knowledge",
  catalog: "Catalog",
  other: "Other",
};

export type ChangeDescription = {
  type: ChangeType;
  domain: string | null; // the domain's name, or the article's title when it has no domain
  domainPath: string | null; // full "domain path › article" for the tooltip
  section: string | null; // one section's title, or "N sections"
  summary: string | null; // a shorter summary when the actions say more than the text; null keeps the stored one
};

const LINE_TYPES: ActionType[] = ["write_line", "revise_line", "retire_line", "move_line"];
const ARTICLE_TYPES: ActionType[] = ["rename_page", "retire_page", "create_section", "rename_section", "retire_section"];
const CLAIM_TYPES: ActionType[] = ["add_claim", "revise_claim", "retire_claim", "set_epistemic_status"];
const LINE_TYPE: Partial<Record<ActionType, ChangeType>> = { revise_line: "line_rewrite", write_line: "line_add", retire_line: "line_remove", move_line: "line_move" };

// THE TYPE: one family wins, in this order (a line edit that also revises its claim is a line edit)
export function classifyChange(types: readonly ActionType[]): ChangeType {
  const set = new Set(types);
  if (set.has("glossary_update")) return "glossary";
  if (set.has("source_lifecycle")) return "source_lifecycle";
  if (set.has("source_review")) return "source_review";
  const only = (allowed: ActionType[]) => types.length > 0 && types.every((type) => allowed.includes(type));
  if (set.has("create_page")) return "article_new";
  if (types.some((type) => ARTICLE_TYPES.includes(type))) return "article_update";
  if (set.has("merge_duplicates")) return "merge";
  const lineTypes = new Set(types.filter((type) => LINE_TYPES.includes(type)));
  if (lineTypes.size === 1) return LINE_TYPE[[...lineTypes][0]!]!;
  if (lineTypes.size > 1) return "line_edit";
  if (only(["link"])) return "links";
  const claimTypes = new Set(types.filter((type) => CLAIM_TYPES.includes(type)));
  if (claimTypes.size > 0) {
    if (claimTypes.size === 1 && claimTypes.has("add_claim")) return "claim_new";
    if (claimTypes.size === 1 && claimTypes.has("retire_claim")) return "claim_retire";
    if ([...claimTypes].every((type) => type === "revise_claim" || type === "set_epistemic_status")) return "claim_edit";
    return "knowledge";
  }
  if (types.length > 0 && types.every((type) => type.endsWith("_entity") || type.endsWith("_domain"))) return "catalog";
  return "other";
}

const lastSegment = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const quote = (content: string) => `“${content.replace(/\s+/g, " ").trim()}”`;

// A summary that says what changed instead of where: the first line's new words, or the stored text without its section name
function shortSummary(type: ChangeType, context: ChangeContext, stored: string): string | null {
  if (context.line_action_count > 0 && type.startsWith("line_")) {
    const verb = type === "line_add" ? "Added" : type === "line_remove" ? "Removed" : type === "line_move" ? "Moved" : "Rewrote";
    const head = `${verb} ${plural(context.line_action_count, "line")}`;
    return context.first_line_content ? `${head}: ${quote(context.first_line_content)}` : head;
  }
  const withoutSection = stored.replace(/ of "[^"]*"$/, "");
  return withoutSection === stored ? null : withoutSection;
}

// DESCRIBE ONE CHANGE SET from its context
export function describeChange(context: ChangeContext, stored: string): ChangeDescription {
  const type = classifyChange(context.action_types);
  const sections = context.section_titles;
  const section = sections.length === 1 ? sections[0]! : sections.length > 1 ? plural(sections.length, "section") : null;

  const paths = context.domain_paths;
  const claimPaths = context.claim_domain_paths;
  let domain: string | null = null;
  let domainPath: string | null = null;
  if (paths.length === 1) [domain, domainPath] = [context.domain_names[0] ?? lastSegment(paths[0]!), paths[0]!];
  else if (paths.length > 1) [domain, domainPath] = [plural(paths.length, "domain"), paths.join(", ")];
  else if (claimPaths.length === 1) [domain, domainPath] = [lastSegment(claimPaths[0]!), claimPaths[0]!];
  else if (claimPaths.length > 1) [domain, domainPath] = [plural(claimPaths.length, "domain"), claimPaths.join(", ")];
  // An article outside the domain tree (an entity's page) is named by its title
  const article = context.article_titles.length === 1 ? context.article_titles[0]! : null;
  if (!domain && article) domain = article;
  if (article) domainPath = domainPath && domainPath !== article ? `${domainPath} › ${article}` : article;

  return { type, domain, domainPath, section, summary: shortSummary(type, context, stored) };
}

// A change set with no actions (or none the reader may see)
export const EMPTY_CONTEXT = (changeSetId: string): ChangeContext => ({
  change_set_id: changeSetId, action_types: [], action_count: 0, line_action_count: 0, first_line_content: null,
  section_titles: [], article_titles: [], domain_names: [], domain_paths: [], claim_domain_paths: [],
});
