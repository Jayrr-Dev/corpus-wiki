import type { Tables } from "@/lib/database/types";

// =====================================================================
// ASSET TAGS: two facets and one spelling per idea. asset_type says what
// kind of media an asset is, from a fixed list; tags say what it is about
// (subjects, settings, named organizations). Every tag, from the Media
// analyst or a person, passes through the same normalizer and is folded
// into a tag already in use when it is the same word in another form
// ("blueprints" -> "blueprint", "site-plan" -> "site plan"), a renamed
// tag's old name, or a one-letter slip of a long tag.
// =====================================================================

export type AssetType = NonNullable<Tables<"assets">["asset_type"]>;
export type AssetEditableField = Tables<"assets">["edited_fields"][number];

export const ASSET_TYPES = [
  "photo", "diagram", "chart", "flowchart", "map", "screenshot", "table", "logo", "drawing", "document scan", "recording", "other",
] as const satisfies readonly AssetType[];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  photo: "Photo", diagram: "Diagram", chart: "Chart", flowchart: "Flowchart", map: "Map", screenshot: "Screenshot", table: "Table",
  logo: "Logo", drawing: "Drawing", "document scan": "Document scan", recording: "Recording", other: "Other",
};

export const MAX_TAGS = 8;
const MAX_TAG_CHARS = 40;

// Words that name a kind of media: they belong in asset_type, never in tags
const TYPE_WORDS = new Set([
  ...ASSET_TYPES, "image", "picture", "photograph", "photography", "graph", "bar chart", "line chart", "pie chart", "flow chart", "flow diagram",
  "schematic", "screen shot", "screen capture", "illustration", "sketch", "scan", "scanned document", "video", "audio", "figure",
].map((word) => tagKey(word)));

// ONE TAG'S SPELLING: lowercase, no "#", no quotes or edge punctuation, single spaces
// ("site_plan" and "Site-Plan " both read "site plan"); "" when nothing is left
export function normalizeTag(raw: string): string {
  return raw.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/^#+/, "")
    .replace(/[_\s]+/g, " ")
    .replace(/["“”‘’`]/g, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+)]+$/gu, "")
    .replace(/^(the|a|an) /, "")
    .trim()
    .slice(0, MAX_TAG_CHARS)
    .trim();
}

// WHAT MAKES TWO TAGS THE SAME: each word singular, spaces and hyphens ignored
// ("Blue-prints" and "blueprint" share "blueprint")
export function tagKey(tag: string): string {
  return normalizeTag(tag).split(/[\s-]+/).map(singular).join("");
}

function singular(word: string): string {
  if (word.length <= 3 || /(ss|us|is|ics|news|series|species)$/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// TRUE when a tag only names a kind of media ("photo", "diagrams", "Screen shot")
export const isTypeWord = (tag: string) => TYPE_WORDS.has(tagKey(tag));

// THE TAGS IN USE, and how a new tag folds into one of them. `known` comes most used first,
// so where two spellings already exist the commoner one wins; `aliases` maps renamed tags to their new name.
export class TagVocabulary {
  private byKey = new Map<string, string>();
  private aliases = new Map<string, string>();

  constructor(known: string[], aliases: { alias: string; tag: string }[] = []) {
    for (const { alias, tag } of aliases) this.aliases.set(tagKey(alias), tag);
    for (const tag of known) this.add(tag);
  }

  get tags(): string[] {
    return [...this.byKey.values()];
  }

  add(tag: string) {
    const key = tagKey(tag);
    if (key && !this.byKey.has(key)) this.byKey.set(key, tag);
  }

  // The tag to store for `raw`: a known tag with the same key, a renamed tag's new name,
  // a known tag one letter off (only for long tags, where that is a slip, not another word), else `raw` cleaned
  canonical(raw: string): string {
    const tag = normalizeTag(raw);
    const key = tagKey(tag);
    if (!key) return "";
    const renamed = this.aliases.get(key);
    if (renamed) return this.byKey.get(tagKey(renamed)) ?? renamed;
    const same = this.byKey.get(key);
    if (same) return same;
    if (key.length >= 7) {
      for (const [knownKey, known] of this.byKey) if (Math.abs(knownKey.length - key.length) <= 1 && withinOneEdit(knownKey, key)) return known;
    }
    return tag;
  }

  // An asset's tags: each folded into the vocabulary, kind-of-media words dropped, no repeats, at most MAX_TAGS.
  // `learn` adds new tags to the vocabulary so later assets in the same pass reuse them.
  clean(tags: string[], { learn = true } = {}): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const tag = this.canonical(raw);
      const key = tagKey(tag);
      if (!key || seen.has(key) || isTypeWord(tag)) continue;
      seen.add(key);
      out.push(tag);
      if (out.length === MAX_TAGS) break;
    }
    if (learn) for (const tag of out) this.add(tag);
    return out;
  }
}

// One insertion, deletion or substitution apart (or equal)
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
