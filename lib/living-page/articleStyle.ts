import rules from "@/skills/encyclopedia-humanizer/references/style-rules.json";

// The skill and runtime writers share this policy instead of maintaining copies.
export const ARTICLE_STYLE_VERSION = rules.version;
export function articleStyle(mode: "article" | "outline" | "definitions"): string {
  return [
    `Editorial policy (${rules.version}):`,
    ...[...rules.voice, ...rules.evidence, ...rules[mode]].map((rule) => `- ${rule}`),
    "Before answering, check the wording against the supplied evidence and remove filler internally. Return only the requested output schema.",
  ].join("\n");
}
