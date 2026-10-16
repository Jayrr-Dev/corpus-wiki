"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, Network, MessagesSquare, Square } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";
import type { AgentActivity, Message, Reference } from "@/lib/chatbot/types";
import { HistorySidebar } from "./HistorySidebar";
import { readHistory, saveConversation, type SavedChat } from "./history";
import { useEntities } from "@/lib/queries";
import { OutputSkillPicker } from "./OutputSkillPicker";
import { ModePicker } from "./ModePicker";
import type { OutputSkillId } from "@/lib/chatbot/outputSkills";
import { ContextPicker } from "./ContextPicker";

const suggestions = [
  { title: "Write an article", text: "Help me write an article from my saved knowledge. What topics have enough evidence?", icon: BookOpen },
  { title: "Add a source", text: "I want to add a source. Ask me for the link and help me import it.", icon: Network },
  { title: "Review exceptions", text: "Review my open exceptions and explain which decisions need my attention.", icon: MessagesSquare },
];

export function Chatbot({ userId }: { userId: string }) {
  const entities = useEntities();
  const [entityId, setEntityId] = useState("");
  const [agent, setAgent] = useState(true);
  const [progress, setProgress] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [outputSkill, setOutputSkill] = useState<OutputSkillId>("natural");
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storageKey = `second-brain:ask:history:${userId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const followAnswer = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (followAnswer.current) bottom.current?.scrollIntoView({ behavior: busy ? "instant" : "smooth" }); }, [messages, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      try { setChats(readHistory(localStorage.getItem(storageKey))); }
      catch { setStorageError("Saved chats could not be loaded. Browser storage may be unavailable."); }
      setHistoryReady(true);
    });
    return () => { disposed = true; };
  }, [storageKey]);

  function persist(next: SavedChat[]) {
    setChats(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(null); }
    catch { setStorageError("Chat history could not be saved. Browser storage may be full or unavailable."); }
  }
  function newChat() {
    setEntityId("");
    setActiveId(null); setMessages([]); setDraft(""); setError(null); setWarning(null); input.current?.focus();
  }
  function selectChat(chat: SavedChat) {
    setEntityId("");
    setActiveId(chat.id); setMessages(chat.messages); setDraft(""); setError(null); setWarning(null); input.current?.focus();
  }

  async function send(question = draft) {
    const content = question.trim();
    if (!content || busy || deciding || !historyReady) return;
    const chatId = activeId ?? crypto.randomUUID();
    followAnswer.current = true;
    setActiveId(chatId);
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next); setDraft(""); setBusy(true); setProgress("Planning your request…"); setError(null); setWarning(null);
    const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch("/api/chatbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, entityId: entityId || undefined, outputSkill, messages: next.slice(-19).filter(message => message.content.trim()).map(({ role, content }) => ({ role, content })) }), signal: active.signal });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Unable to complete the answer.");
      }
      if (!response.body) throw new Error("No answer received. Please try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let answer: Message = { role: "assistant", content: "", references: [], activities: [] };
      let finished = false;
      const update = () => setMessages([...next, { ...answer }]);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          buffered += decoder.decode(value, { stream: !done });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          if (done && buffered) lines.push(buffered);
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "error") throw new Error(event.error);
            if (event.type === "progress") setProgress(event.content);
            if (event.type === "activity") { answer.activities = [...(answer.activities ?? []), event.activity]; update(); }
            if (event.type === "sources") { answer.references = event.references; setWarning(event.warning); }
            if (event.type === "answer") { answer.content = event.content; update(); }
            if (event.type === "done") {
              answer = { role: "assistant", content: event.content, references: event.references, activities: event.activities };
              finished = true; update(); setWarning(event.warning);
            }
          }
          if (done) break;
        }
        if (!finished) throw new Error("The answer was interrupted. Please try again.");
      } catch (caught) {
        if (!answer.content && !answer.activities?.length) throw caught;
        // Keep useful text when stopped or disconnected, including in saved history.
        setWarning(active.signal.aborted ? "Response stopped." : "The response was interrupted. You can ask me to continue.");
        update();
      } finally { reader.releaseLock(); }
      persist(saveConversation(chats, chatId, [...next, answer]));
    } catch (caught) {
      setMessages(next.slice(0, -1)); setDraft(content);
      if (!active.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to connect. Try again.");
    } finally { setBusy(false); controller.current = null; input.current?.focus(); }
  }

  async function applyDecision(activity: AgentActivity) {
    if (!activity.decision || deciding || busy) return;
    setDeciding(activity.id); setError(null);
    try {
      const response = await fetch("/api/chatbot/exception", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activity.decision) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The decision could not be applied.");
      const updated = messages.map(message => ({ ...message, activities: message.activities?.map(item => item.id === activity.id ? { ...item, status: "completed" as const, detail: activity.decision!.accept ? "Exception accepted. Follow-up processing may still be running." : "Exception rejected.", decision: undefined } : item) }));
      setMessages(updated);
      if (activeId) persist(saveConversation(chats, activeId, updated));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to apply the decision."); }
    finally { setDeciding(null); }
  }

  return <div className="flex h-[calc(100%-2.75rem)] min-h-0 overflow-hidden md:h-full">
    <HistorySidebar chats={chats} activeId={activeId} busy={busy || !!deciding || !historyReady} onSelect={selectChat} onNew={newChat} onDelete={id => { persist(chats.filter(chat => chat.id !== id)); if (id === activeId) newChat(); }} />
    <section data-tour="reading-pane" aria-label="Ask your second brain" className={`flex min-h-0 min-w-0 flex-1 flex-col ${!messages.length ? "overflow-y-auto" : ""}`}>
    <div className={`flex w-full flex-col ${!messages.length ? "my-auto shrink-0 py-10 sm:py-16" : "min-h-0 flex-1"}`}>
    <div onScroll={event => { const el = event.currentTarget; followAnswer.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className={messages.length ? "min-h-0 flex-1 overflow-y-auto px-5" : "px-5"}>
      {!messages.length ? <div className="mx-auto max-w-3xl pb-6">
        <h2 className="text-center text-title font-semibold">What’s on your mind?</h2>
        <p className="mx-auto mt-3 max-w-md text-center text-panel leading-6 text-muted-foreground">Write articles, add sources, and work through exceptions with your second brain.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">{suggestions.map(({ title, text, icon: Icon }) => <button key={title} disabled={busy || !historyReady} onClick={() => void send(text)} className="rounded-xl border p-4 text-left transition-colors hover:border-foreground/20 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><span className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</span><span className="text-panel leading-5 text-muted-foreground">{text}</span></button>)}</div>
      </div> : <div className="mx-auto max-w-3xl space-y-8 py-8" role="log" aria-label="Conversation">{messages.map((message, index) => <article key={index} className={message.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-sidebar px-5 py-3" : "pr-2"}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "Second Brain"}</p>
        {!!message.activities?.length && <div className="mb-4 space-y-2" aria-label="Agent actions">{message.activities.map(activity => <div key={activity.id} className="rounded-xl border bg-sidebar/40 p-3 text-sm">
          <div className="font-medium">{activity.label}</div>
          <p className={`mt-1 text-xs ${activity.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{activity.detail}</p>
          {activity.href && <Link href={activity.href} className="mt-2 inline-block text-xs underline">Open result</Link>}
          {activity.decision && activity.status === "confirmation" && <div className="mt-3 space-y-2"><p>{activity.decision.accept ? "Accept" : "Reject"} exception: {activity.decision.note}</p><button type="button" disabled={busy || !!deciding} onClick={() => void applyDecision(activity)} className="rounded-md border px-3 py-1.5 font-medium hover:bg-hover disabled:opacity-40">{deciding === activity.id ? "Applying…" : `Confirm ${activity.decision.accept ? "acceptance" : "rejection"}`}</button></div>}
        </div>)}</div>}
        <div className="text-body leading-7 break-words"><Answer content={message.content} references={message.references ?? []} /></div>
        {message.role === "assistant" && !!message.content && !!message.references?.length && !(busy && index === messages.length - 1) && <details className="mt-5 rounded-xl border bg-sidebar/40 px-4 py-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Sources · {message.references.length}</summary><div className="mt-3 grid gap-1">{message.references.map((ref, index) => <Link key={ref.id} href={ref.href} className="flex gap-3 rounded-md px-2 py-2 text-sm hover:bg-hover"><span className="text-muted-foreground">{index + 1}.</span><span>{ref.title}<span className="ml-2 text-xs text-muted-foreground">{ref.kind}</span></span></Link>)}</div></details>}
      </article>)}{busy && <p role="status" className="animate-pulse text-sm text-muted-foreground">{progress || "Searching your knowledge…"}</p>}<div ref={bottom} /></div>}
    </div>
    <div className="mx-auto w-full max-w-[51rem] shrink-0 px-5 pt-3 pb-5">
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {warning && <p role="status" className="mb-3 text-xs text-muted-foreground">{warning}</p>}
      {storageError && <p role="alert" className="mb-3 text-xs text-destructive">{storageError}</p>}
      <form data-tour="ask-composer" onSubmit={event => { event.preventDefault(); void send(); }} className="rounded-2xl border bg-sidebar p-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <textarea ref={input} aria-label="Message Ask" placeholder="Ask your second brain…" value={draft} onChange={event => setDraft(event.target.value)} maxLength={8000} rows={2} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="max-h-40 w-full resize-none bg-transparent px-1 py-2 text-panel outline-none" />
        <div className="mt-2 flex items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-1"><ContextPicker disabled={busy} value={entityId} options={(entities.data ?? []).filter(entity => !entity.merged_into_id).map(entity => ({ id: entity.id, name: entity.name, type: entity.type }))} onChange={setEntityId} loading={entities.isPending} failed={entities.isError} /><OutputSkillPicker value={outputSkill} onChange={setOutputSkill} disabled={busy} /><ModePicker agent={agent} onChange={setAgent} disabled={busy} /></div>
          <Tooltip content={busy ? "Stop response" : "Send message"}><button type={busy ? "button" : "submit"} onClick={busy ? event => { event.preventDefault(); controller.current?.abort(); } : undefined} disabled={!busy && !draft.trim()} aria-label={busy ? "Stop response" : "Send message"} className="flex size-9 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30">{busy ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}</button></Tooltip>
        </div>
      </form>
    </div>
    </div>
  </section></div>;
}

function Answer({ content, references }: { content: string; references: Reference[] }) {
  function inline(text: string) {
    return text.replace(/\[([KASG]\d+(?:,\s*[KASG]\d+)+)\]/g, (_, ids: string) => ids.split(/,\s*/).map(id => `[${id}]`).join(" ")).split(/(\*\*[^*]+\*\*|\[[KASG]\d+\])/g).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
      const position = references.findIndex(r => `[${r.id}]` === part);
      if (position < 0) return part;
      const ref = references[position]!;
      return <Tooltip key={index} content={ref.title}><Link href={ref.href} aria-label={`Source ${position + 1}: ${ref.title}`} className="mx-0.5 inline-flex size-5 items-center justify-center rounded bg-hover align-super text-xs font-medium leading-none text-muted-foreground hover:text-foreground">{position + 1}</Link></Tooltip>;
    });
  }
  return <div className="space-y-4">{content.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
    const lines = block.split("\n");
    return <div key={index} className="space-y-2">{lines.map((line, lineIndex) => {
      if (/^#{1,6}\s/.test(line)) return <h3 key={lineIndex} className="pt-2 text-base font-semibold tracking-tight">{inline(line.replace(/^#{1,6}\s+/, ""))}</h3>;
      if (/^\s*([-*]|\d+[.)])\s/.test(line)) return <div key={lineIndex} className="flex gap-3 pl-1"><span className="text-muted-foreground">•</span><p>{inline(line.replace(/^\s*([-*]|\d+[.)])\s+/, ""))}</p></div>;
      return <p key={lineIndex}>{inline(line)}</p>;
    })}</div>;
  })}</div>;
}
