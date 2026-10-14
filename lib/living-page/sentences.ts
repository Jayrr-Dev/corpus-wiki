import type { SentenceLink, WrittenSentence } from "./types";

// =====================================================================
// SENTENCES <-> BODY: a section body is its sentences joined with one
// space; sentence_links record where each sentence sits in the body.
// Pure functions, shared by the server (build) and the wiki page (read).
// =====================================================================

// SEPARATOR between sentences in a body
const SENTENCE_SEPARATOR = " ";

// One piece of a body for display: a linked sentence or the plain text between
export type BodySpan = { text: string; link: SentenceLink | null };

// Joins sentences into a body and records each sentence's [start, end) offsets
export function composeBody(sentences: WrittenSentence[]): { body: string; sentenceLinks: SentenceLink[] } {
  const kept = sentences.map((s) => ({ text: s.text.trim(), unitIds: s.unitIds })).filter((s) => s.text !== "");
  const sentenceLinks: SentenceLink[] = [];
  let cursor = 0;
  for (const sentence of kept) {
    sentenceLinks.push({ start: cursor, end: cursor + sentence.text.length, unitIds: sentence.unitIds });
    cursor += sentence.text.length + SENTENCE_SEPARATOR.length;
  }
  return { body: kept.map((s) => s.text).join(SENTENCE_SEPARATOR), sentenceLinks };
}

// Cuts a body into display spans along its links (gaps and unlinked text become plain spans)
export function splitBody(body: string, links: SentenceLink[]): BodySpan[] {
  const ordered = links
    .filter((link) => link.start >= 0 && link.end <= body.length && link.start < link.end)
    .toSorted((a, b) => a.start - b.start);
  const spans: BodySpan[] = [];
  let cursor = 0;
  for (const link of ordered) {
    if (link.start < cursor) continue; // overlapping link: keep the first
    if (link.start > cursor) spans.push({ text: body.slice(cursor, link.start), link: null });
    spans.push({ text: body.slice(link.start, link.end), link });
    cursor = link.end;
  }
  if (cursor < body.length) spans.push({ text: body.slice(cursor), link: null });
  return spans;
}
