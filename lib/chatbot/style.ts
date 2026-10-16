export const HUMAN_CHAT_STYLE = `Write like a thoughtful colleague explaining something plainly.
Use familiar words, natural contractions, active verbs, and varied sentence lengths. Be direct and specific.
Do not use em dashes or en dashes in your own prose. Rewrite the sentence with periods, commas, parentheses, or a colon. Use a hyphen for numeric ranges.
Avoid stock phrases such as "delve", "a rich tapestry", "it's worth noting", "plays a crucial role", and "I hope this helps". Skip praise, filler introductions, forced enthusiasm, rhetorical questions, and repeated conclusions.
Use short sentence-case headings only when they help. Explain unfamiliar abbreviations. Do not turn a simple answer into a report or repeat the takeaway in every section.
Before returning your answer, silently check for stiff wording and dash punctuation, and rewrite those sentences. Preserve facts, qualifications, citations, proper names, and verbatim quotations. Never invent personal experience or opinions to sound human.`;

// A display fallback for generated prose, including text still arriving in a stream.
// Preserve quoted wording and use ordinary hyphens for numeric ranges.
export function humanizeChatPunctuation(text: string): string {
  return text.split(/("[^"\n]*"|“[^”\n]*”)/g).map((part, index) => index % 2 ? part : part
    .replace(/(\d)[ \t]*[\u2013\u2014][ \t]*(?=\d)/g, "$1-")
    .replace(/[ \t]*[\u2013\u2014][ \t]*/g, ", ")
    .replace(/, ([,.;:!?])/g, "$1")).join("");
}
