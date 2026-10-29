import { sha256 } from "./hash";

// =====================================================================
// PASSAGES: an extracted file split into located pieces of text, the
// unit every citation points to. One passage per paragraph; a paragraph
// longer than MAX_PASSAGE_CHARS is cut at sentence ends.
// =====================================================================

// SPLIT SETTINGS
const MAX_PASSAGE_CHARS = 700;
const PARAGRAPH_BREAK = /\n\s*\n/;
const SENTENCE_END = /(?<=[.!?])\s+/;

// ONE PAGE OF EXTRACTED TEXT (page is null for formats without pages; time is where a
// video's transcript piece starts, "mm:ss"; figure is the stored picture an embedded
// image's description was written from, its path in the 'sources' bucket; sectionPath
// is the book part and chapter a PDF page belongs to; speaker makes the page one message of a
// conversation: it stays one passage, cut only when too long, each piece labelled with it)
export type ExtractedPage = { page: number | null; text: string; time?: string; figure?: string; sectionPath?: readonly string[]; speaker?: string };

// WHAT ingest_source STORES PER PASSAGE
export type PassageDraft = {
  position: number;
  text: string;
  location: { page?: number; heading?: string; sectionPath?: string[]; time?: string; figure?: string };
  hash: string;
  speakerLabel: string | null;
};

// Splits every page into passages, numbering them across the whole file
export function splitIntoPassages(pages: readonly ExtractedPage[]): PassageDraft[] {
  const drafts: Omit<PassageDraft, "position">[] = [];
  let heading: string | undefined;
  for (const { page, text, time, figure, sectionPath, speaker } of pages) {
    if (speaker) {
      drafts.push(...messagePassages(speaker, text, page));
      continue;
    }
    for (const paragraph of text.split(PARAGRAPH_BREAK)) {
      const clean = paragraph.replace(/\s*\n\s*/g, " ").trim();
      if (!clean) continue;
      if (clean.startsWith("#")) heading = clean.replace(/^#+\s*/, "");
      const location = {
        ...(page !== null && { page }),
        ...(heading && { heading }),
        ...(sectionPath?.length ? { sectionPath: [...sectionPath] } : {}),
        ...(time && { time }),
        ...(figure && { figure }),
      };
      drafts.push(...packSentences(clean).map((piece) => passageOf(piece, location)));
    }
  }
  return drafts.map((draft, position) => ({ ...draft, position }));
}

// Cuts a long paragraph into pieces of whole sentences, each at most MAX_PASSAGE_CHARS
function packSentences(paragraph: string): string[] {
  if (paragraph.length <= MAX_PASSAGE_CHARS) return [paragraph];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of paragraph.split(SENTENCE_END)) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > MAX_PASSAGE_CHARS && current) {
      pieces.push(current);
      current = sentence;
    } else current = next;
  }
  return current ? [...pieces, current] : pieces;
}

// One passage with its hash and the speaker named at its start ("Jonas: ...")
function passageOf(text: string, location: PassageDraft["location"]): Omit<PassageDraft, "position"> {
  const speaker = /^([A-Z][\w .'-]{0,40}):\s/.exec(text)?.[1] ?? null;
  return { text, location, hash: sha256(text), speakerLabel: speaker };
}

// ONE MESSAGE OF A CONVERSATION: its paragraphs read as one passage starting "Speaker: ", so a
// message never splits mid-thought; a long one is cut at sentence ends, every piece labelled
function messagePassages(speaker: string, text: string, page: number | null): Omit<PassageDraft, "position">[] {
  const clean = text.replace(/\s*\n\s*/g, " ").trim();
  if (!clean) return [];
  const location = page !== null ? { page } : {};
  return packSentences(clean).map((piece) => {
    const labelled = `${speaker}: ${piece}`;
    return { text: labelled, location, hash: sha256(labelled), speakerLabel: speaker };
  });
}
