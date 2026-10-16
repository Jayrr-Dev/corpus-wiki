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

// Always included by both the article writer and page reviewer, including custom skills.
export const TOPIC_FIRST_PROSE = `Write natural, topic-first sentences. This applies to every generated paragraph, not just the introduction. On a topic page, a paragraph that opens with the parent organization as the grammatical subject must be recast around the topic, activity, or requirement when that preserves meaning. Keep necessary organizational scope within the sentence. Do not retain a company-first opening just because it is factually correct. On a topic page, open the lead with the subject named by the page title, using a supported, more specific phrase where helpful. Start the lead directly with the topic phrase, then place organizational scope after it, for example "Safety communication at [organization] includes ...". Do not move the company to a front-loaded "At [organization], ..." phrase as a workaround. Body paragraphs should likewise start with their activity or requirement. Examples illustrate sentence structure only; never copy their facts. Keep the organization as scope rather than making its name the subject of every paragraph. A page about an organization may naturally open with that organization's name.
Name the organization where needed to preserve attribution; never turn its documented practices into universal rules. Once the scope is clear, start body sentences with the relevant activity, requirement, person, or process. Repeat the full organization name only when it prevents ambiguity or distinguishes another organization. Do not mechanically replace it with "the company" in every sentence.
Prefer direct, idiomatic wording, clear subjects and verbs, and sentences with one main point. Split long chains of conditions into readable sentences without dropping a condition, exception, frequency, responsibility, or citation. Avoid circular phrasing, stiff corporate wording, filler, and repeated facts. Keep the lead a brief introduction and the procedural detail in the body. Before returning, check the opening of the lead AND each body paragraph you write or review. Correct repeated organization-first openings with actual line edits, not a summary saying the prose is acceptable. Preserve modality exactly: an opportunity to do something is not proof it happened, a requirement is not proof of compliance, and a plan is not an established practice. Preserve the evidence and meaning; do not add a definition or claim just to improve the opening.`;
