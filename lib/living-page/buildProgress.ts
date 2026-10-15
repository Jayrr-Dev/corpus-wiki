// =====================================================================
// SECTION BUILD PROGRESS: while a section is rewritten, the server says
// what step it is on and streams the paragraphs as the model writes them.
// Nothing here is stored: messages go over a Supabase Realtime Broadcast
// channel per section, and the committed lines replace the draft when the
// build finishes. Shared by the server (sender) and the page (listener).
// =====================================================================

// The draft so far: rewritten text keyed by the line it replaces, then new paragraphs in order
export type SectionDraft = { revised: Record<string, string>; added: string[] };

// One message on the channel. `seq` rises with every message, so a late one never overwrites a newer one.
export type SectionBuildEvent =
  | { kind: "step"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "draft"; draft: SectionDraft }
  | { kind: "done" };
export type SectionBuildMessage = SectionBuildEvent & { seq: number };

// What a build reports. Calls never throw and never wait, so reporting cannot slow or break a build.
export interface SectionProgress {
  step(text: string): void;
  thinking(text: string): void;
  draft(draft: SectionDraft): void;
  done(): void;
}

export const SECTION_BUILD_EVENT = "build";

// One channel per section, so a page only hears the sections it shows
export const sectionBuildChannel = (sectionId: string) => `section-build:${sectionId}`;

// Builds a reporter from a send function: numbers each message and spaces out drafts and
// thinking (the model streams many tokens a second; the page only needs a few frames)
export function progressReporter(send: (message: SectionBuildMessage) => void, minIntervalMs = 250): SectionProgress {
  let seq = 0;
  let lastFrameAt = 0;
  let pending: SectionBuildEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = (event: SectionBuildEvent) => send({ ...event, seq: ++seq });
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) {
      lastFrameAt = Date.now();
      emit(pending);
      pending = null;
    }
  };
  const frame = (event: SectionBuildEvent) => {
    pending = event;
    const wait = minIntervalMs - (Date.now() - lastFrameAt);
    if (wait <= 0) flush();
    else timer ??= setTimeout(flush, wait);
  };
  return {
    step: (text) => {
      flush();
      emit({ kind: "step", text });
    },
    thinking: (text) => frame({ kind: "thinking", text }),
    draft: (draft) => frame({ kind: "draft", draft }),
    done: () => {
      flush();
      emit({ kind: "done" });
    },
  };
}

// =====================================================================
// READING A HALF-WRITTEN ANSWER: the writer answers with JSON shaped
// {"revise":[{"line":"L1","text":"..."}],"retire":[...],"add":[{"text":"..."}]}.
// While it streams the JSON is unfinished, so the paragraph texts are
// picked out with patterns instead of JSON.parse; the last one may stop
// mid-sentence. Only a preview: the finished answer is parsed for real.
// =====================================================================

const STRING_BODY = String.raw`((?:[^"\\]|\\.)*)`;
const REVISE_ITEM = new RegExp(String.raw`\{\s*"line"\s*:\s*"([^"]*)"\s*,\s*"text"\s*:\s*"${STRING_BODY}`, "g");
const ADD_ITEM = new RegExp(String.raw`\{\s*"text"\s*:\s*"${STRING_BODY}`, "g");

// The revise and add lists by line ref (L1..) and order, from however much of the answer has arrived
export function partialSectionAnswer(content: string): { revised: { line: string; text: string }[]; added: string[] } {
  const reviseAt = keyIndex(content, "revise");
  const addAt = keyIndex(content, "add");
  const end = (start: number) => [reviseAt, addAt, keyIndex(content, "retire")].filter((at) => at > start).reduce((min, at) => Math.min(min, at), content.length);
  const revisePart = reviseAt < 0 ? "" : content.slice(reviseAt, end(reviseAt));
  const addPart = addAt < 0 ? "" : content.slice(addAt, end(addAt));
  return {
    revised: [...revisePart.matchAll(REVISE_ITEM)].map((match) => ({ line: match[1] ?? "", text: decodePartialString(match[2] ?? "") })),
    added: [...addPart.matchAll(ADD_ITEM)].map((match) => decodePartialString(match[1] ?? "")),
  };
}

// Where `"key":` starts as a key (a quote inside a string value is always escaped)
function keyIndex(content: string, key: string): number {
  return content.search(new RegExp(String.raw`(?<!\\)"${key}"\s*:`));
}

// Decodes a JSON string body that may stop partway through an escape
function decodePartialString(body: string): string {
  const whole = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/\\$/, "");
  try {
    return JSON.parse(`"${whole}"`) as string;
  } catch {
    return whole;
  }
}
