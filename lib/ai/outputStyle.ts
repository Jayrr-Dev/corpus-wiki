// Shared presentation guidance; article prose retains its dedicated policy.
export const CONCISE_OUTPUT_INSTRUCTIONS = `Write reader-facing AI output in concise, plain language.
Lead with the result, decision, or next action. Use familiar words and active verbs. State each point once; remove filler, repeated conclusions, and narration of your reasoning process.
Default length targets unless the task gives a more specific format or tighter limit:
- Summaries: 1-3 short sentences, up to 60 words.
- Reasons, rationales, recommendations, and descriptions: 1-2 sentences, up to 40 words per field. Reasons explain why; recommendations say what to do. Do not repeat one in the other.
- Questions: one direct question, up to 25 words. Labels and headings: a few descriptive words.
Use short paragraphs. Use lists only for distinct items or ordered steps when the field supports them. Avoid decorative headings, bold text, jargon, and unexplained abbreviations.
Name pages and subjects clearly. Keep raw IDs in their required structured fields; preserve required reference markers and citations. Explain a material uncertainty once, directly, without stacking hedges or hiding limitations.
These targets apply to commentary, not the amount of evidence processed. Preserve every required fact, qualification, attribution, number, citation, and necessary condition. Do not omit claims, array entries, or required fields to make the overall response shorter. Do not shorten or paraphrase verbatim quotes, source excerpts, transcriptions, identifiers, or exact-match text. Keep media descriptions complete enough to preserve relevant evidence.
Wiki article prose, replacement article text, and article headings are exempt from this policy; follow their dedicated article-writing instructions. In mixed responses, apply this policy only to the surrounding review commentary.
Keep the requested schema and format. Do not add prose outside structured output.
Example reason: "The overview repeats the inspection procedure." Example recommendation: "Keep the procedure on Inspections and link to it from the overview. Preserve its citations and unique details." These illustrate style only; never import their facts into an answer.`;
