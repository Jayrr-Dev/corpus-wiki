"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import Link from "next/link";
import { ArrowUp, BookOpen, MessagesSquare, Network, Square } from "lucide-react";
import { ContextPicker } from "@/app/(app)/chatbot/ContextPicker";
import { HistorySidebar } from "@/app/(app)/chatbot/HistorySidebar";
import { ModePicker } from "@/app/(app)/chatbot/ModePicker";
import { OutputSkillPicker } from "@/app/(app)/chatbot/OutputSkillPicker";
import { Tooltip } from "@/components/standard/tooltip";
import { Camera, Cursor, easeOut, Highlight, interaction, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import type { Reference } from "@/lib/chatbot/types";
import { ASK_ANSWER, ASK_CHAT_ID, ASK_HISTORY, ASK_QUESTION, ASK_REFERENCES } from "@/lib/video-stage/phoenix/intake";

// ASK: "Ask it anything… like, 'why did we switch payment providers?' And it answers from what your
// team actually wrote. With sources." The question types into the composer, the cursor clicks Send,
// the answer streams in with numbered source chips that pop, and the cursor opens the Sources list,
// which a Highlight rings ("With sources"). 8 seconds.
//
// app/(app)/chatbot/Chatbot.tsx keeps its messages in state filled by a streaming fetch, and its
// answer markup is private, so the layout and Answer below copy it closely; the history sidebar and
// the composer's pickers are the real components.

const DURATION = 8;
const TYPE_FROM = 0.4;
const TYPE_TO = 2.6;
const SEND = 2.9;
const STREAM_FROM = 3.2;
const STREAM_TO = 5.6;
const SOURCES_CLICK = 6.0;

// Frame pixels, measured on the stage at 1920x1080
const SEND_BUTTON = { x: 1605, y: 690 };
const SOURCES_SUMMARY = { x: 915, y: 388 };
const SOURCES_LIST = { x: 864, y: 369, w: 759, h: 169 };

const suggestions = [
  { title: "Write an article", text: "Help me write an article from my saved knowledge. What topics have enough evidence?", icon: BookOpen },
  { title: "Add a source", text: "I want to add a source. Ask me for the link and help me import it.", icon: Network },
  { title: "Review exceptions", text: "Review my open exceptions and explain which decisions need my attention.", icon: MessagesSquare },
];

// THE STREAMED ANSWER at progress p: whole words only, a citation shows once complete, and an open ** is closed
function streamed(p: number): string {
  let text = ASK_ANSWER.slice(0, Math.round(p * ASK_ANSWER.length));
  if (p < 1) text = text.replace(/\S*$/, "");
  text = text.replace(/\[[^\]]*$/, "");
  if ((text.match(/\*\*/g)?.length ?? 0) % 2 === 1) text += "**";
  return text.trimEnd();
}

// The time the streamed text reaches a character of the full answer
const reachedAt = (offset: number) => STREAM_FROM + (offset / ASK_ANSWER.length) * (STREAM_TO - STREAM_FROM);

// A chip's pop: grows past full size and settles
function pop(t: number, at: number): number {
  const p = seg(t, at, at + 0.3);
  return p >= 1 ? 1 : 0.4 + 0.6 * easeOut(p) + 0.25 * Math.sin(p * Math.PI);
}

// The answer's paragraphs split into text, bold and citation parts, each with its offset in the full answer
function answerParts(content: string): { part: string; at: number }[][] {
  const blocks: { part: string; at: number }[][] = [];
  let at = 0;
  for (const block of content.split("\n\n")) {
    const parts: { part: string; at: number }[] = [];
    for (const part of block.split(/(\*\*[^*]+\*\*|\[[KASG]\d+\])/g)) {
      parts.push({ part, at });
      at += part.length;
    }
    at += 2;
    if (block) blocks.push(parts);
  }
  return blocks;
}

// ANSWER: Chatbot.tsx's Answer markup; each chip pops when the stream reaches it
function Answer({ t, content, references }: { t: number; content: string; references: Reference[] }) {
  function inline(parts: { part: string; at: number }[]) {
    return parts.map(({ part, at }, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
      const position = references.findIndex((r) => `[${r.id}]` === part);
      if (position < 0) return part;
      const ref = references[position]!;
      const scale = pop(t, reachedAt(at + part.length));
      return <Tooltip key={index} content={ref.title}><Link href={ref.href} aria-label={`Source ${position + 1}: ${ref.title}`} style={{ transform: `scale(${scale})`, boxShadow: scale > 1.02 ? "0 0 14px rgb(160 190 255 / 0.55)" : undefined }} className="mx-0.5 inline-flex size-5 items-center justify-center rounded bg-hover align-super text-xs font-medium leading-none text-muted-foreground hover:text-foreground">{position + 1}</Link></Tooltip>;
    });
  }
  return <div className="space-y-4">{answerParts(content).map((parts, index) => <div key={index} className="space-y-2"><p>{inline(parts)}</p></div>)}</div>;
}

function Ask({ t }: { t: number }) {
  const sent = t >= SEND + 0.05;
  const answering = t >= STREAM_FROM;
  const busy = sent && t < STREAM_TO + 0.1;
  const draft = sent ? "" : ASK_QUESTION.slice(0, Math.round(seg(t, TYPE_FROM, TYPE_TO) * ASK_QUESTION.length));
  const answer = answering ? streamed(seg(t, STREAM_FROM, STREAM_TO)) : "";
  const sourcesOpen = t >= SOURCES_CLICK + 0.05;
  const chats = sent ? [{ id: ASK_CHAT_ID, title: ASK_QUESTION, updatedAt: 0, messages: [] }, ...ASK_HISTORY] : ASK_HISTORY;
  const hasMessages = sent;
  return (
    <StageProviders>
      <Camera t={t} keys={[[0, 1, 960, 560], [2.8, 1.1, 1060, 580], [3.3, 1.04, 960, 300], [5.6, 1.08, 960, 300], [8, 1.12, 960, 300]]}>
        <StageShell>
          <div className="flex h-[calc(100%-2.75rem)] min-h-0 overflow-hidden md:h-full">
            <HistorySidebar chats={chats} activeId={sent ? ASK_CHAT_ID : null} busy={busy} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} />
            <section data-tour="reading-pane" aria-label="Ask your wiki" className={`flex min-h-0 min-w-0 flex-1 flex-col ${!hasMessages ? "overflow-y-auto" : ""}`}>
              <div className={`flex w-full flex-col ${!hasMessages ? "my-auto shrink-0 py-10 sm:py-16" : "min-h-0 flex-1"}`}>
                <div className={hasMessages ? "min-h-0 flex-1 overflow-y-auto px-5" : "px-5"}>
                  {!hasMessages ? <div className="mx-auto max-w-3xl pb-6">
                    <h2 className="text-center text-title font-semibold">What’s on your mind?</h2>
                    <p className="mx-auto mt-3 max-w-md text-center text-panel leading-6 text-muted-foreground">Write articles, add sources, and work through exceptions with your wiki.</p>
                    <div className="mt-8 grid gap-3 sm:grid-cols-3">{suggestions.map(({ title, text, icon: Icon }) => <button key={title} type="button" className="rounded-xl border p-4 text-left"><span className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</span><span className="text-panel leading-5 text-muted-foreground">{text}</span></button>)}</div>
                  </div> : <div className="mx-auto max-w-3xl space-y-8 py-8" role="log" aria-label="Conversation">
                    <article className="ml-auto w-fit max-w-[85%] rounded-2xl bg-sidebar px-5 py-3" style={{ opacity: easeOut(seg(t, SEND, SEND + 0.25)), transform: `translateY(${(1 - easeOut(seg(t, SEND, SEND + 0.25))) * 16}px)` }}>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">You</p>
                      <div className="text-body leading-7 break-words"><div className="space-y-4"><div className="space-y-2"><p>{ASK_QUESTION}</p></div></div></div>
                    </article>
                    {answering ? <article className="pr-2">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Corpus Wiki</p>
                      <div className="text-body leading-7 break-words"><Answer t={t} content={answer} references={ASK_REFERENCES} /></div>
                      {!busy ? <details open={sourcesOpen} className="mt-5 rounded-xl border bg-sidebar/40 px-4 py-3" style={{ opacity: easeOut(seg(t, STREAM_TO + 0.1, STREAM_TO + 0.35)) }}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Sources · {ASK_REFERENCES.length}</summary>
                        <div className="mt-3 grid gap-1">{ASK_REFERENCES.map((ref, index) => {
                          const land = easeOut(seg(t, SOURCES_CLICK + 0.05 + index * 0.12, SOURCES_CLICK + 0.35 + index * 0.12));
                          return <Link key={ref.id} href={ref.href} className="flex gap-3 rounded-md px-2 py-2 text-sm" style={{ opacity: land, transform: `translateY(${(1 - land) * 8}px)` }}><span className="text-muted-foreground">{index + 1}.</span><span>{ref.title}<span className="ml-2 text-xs text-muted-foreground">{ref.kind}</span></span></Link>;
                        })}</div>
                      </details> : null}
                    </article> : null}
                    {busy && !answer ? <p role="status" className="text-sm text-muted-foreground" style={{ opacity: 0.55 + 0.45 * Math.abs(Math.cos(t * 3)) }}>Searching your knowledge…</p> : null}
                  </div>}
                </div>
                <div className="mx-auto w-full max-w-[51rem] shrink-0 px-5 pt-3 pb-5">
                  <form data-tour="ask-composer" onSubmit={(event) => event.preventDefault()} className={`rounded-2xl border bg-sidebar p-3 shadow-sm ${!sent ? "ring-1 ring-ring" : ""}`}>
                    <textarea aria-label="Message Ask" placeholder="Ask your wiki…" value={draft} readOnly rows={2} className="max-h-40 w-full resize-none bg-transparent px-1 py-2 text-panel outline-none" />
                    <div className="mt-2 flex items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-1"><ContextPicker disabled={busy} value="" options={[]} onChange={() => {}} loading={false} failed={false} /><OutputSkillPicker value="natural" onChange={() => {}} disabled={busy} /><ModePicker agent onChange={() => {}} disabled={busy} /></div>
                      <span style={{ display: "inline-flex", ...interaction(t, { hover: [SEND - 0.35, SEND + 0.3], click: SEND }) }}>
                        <Tooltip content={busy ? "Stop response" : "Send message"}><button type="button" disabled={!busy && !draft.trim()} aria-label={busy ? "Stop response" : "Send message"} className="flex size-9 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30">{busy ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}</button></Tooltip>
                      </span>
                    </div>
                  </form>
                </div>
              </div>
            </section>
          </div>
        </StageShell>
        <Highlight t={t} from={SOURCES_CLICK + 0.2} to={DURATION + 0.5} {...SOURCES_LIST} radius={12} />
        <Cursor
          t={t}
          path={[[0, 1990, 760], [1.6, 1990, 760], [2.65, SEND_BUTTON.x, SEND_BUTTON.y], [3.0, SEND_BUTTON.x, SEND_BUTTON.y], [3.6, SEND_BUTTON.x + 30, SEND_BUTTON.y + 60], [5.2, 1200, 640], [5.8, SOURCES_SUMMARY.x, SOURCES_SUMMARY.y], [6.15, SOURCES_SUMMARY.x, SOURCES_SUMMARY.y], [8, SOURCES_SUMMARY.x - 130, SOURCES_SUMMARY.y + 40]]}
          clicks={[SEND, SOURCES_CLICK]}
        />
      </Camera>
    </StageProviders>
  );
}

export const ask: Scene = { duration: DURATION, Component: Ask, title: "Ask" };
