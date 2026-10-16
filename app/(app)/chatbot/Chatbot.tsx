"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, MessageCircle, Plus, Square } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";
import type { Message, Reference } from "@/lib/chatbot/types";
import { HistorySidebar } from "./HistorySidebar";
import { readHistory, saveConversation, type SavedChat } from "./history";
import { useEntities } from "@/lib/queries";
import { OptionSelect } from "@/components/actions/OptionSelect";

const suggestions = ["What are the main themes in my knowledge?", "Help me connect ideas across my articles", "What do my sources agree or disagree on?"];

export function Chatbot({ userId }: { userId: string }) {
  const entities = useEntities();
  const [entityId, setEntityId] = useState("");
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
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
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
    if (!content || busy || !historyReady) return;
    const chatId = activeId ?? crypto.randomUUID();
    setActiveId(chatId);
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next); setDraft(""); setBusy(true); setError(null); setWarning(null);
    const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch("/api/chatbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: entityId || undefined, messages: next.slice(-19).map(({ role, content }) => ({ role, content })) }), signal: active.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to complete the answer.");
      const completed: Message[] = [...next, { role: "assistant", content: body.content, references: body.references }];
      setMessages(completed);
      persist(saveConversation(chats, chatId, completed));
      setWarning(body.warning);
    } catch (caught) {
      setMessages(next.slice(0, -1)); setDraft(content);
      if (!active.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to connect. Try again.");
    } finally { setBusy(false); controller.current = null; input.current?.focus(); }
  }

  return <div className="flex h-[calc(100dvh-3rem)] min-h-0 md:h-dvh">
    <HistorySidebar chats={chats} activeId={activeId} busy={busy || !historyReady} onSelect={selectChat} onNew={newChat} onDelete={id => { persist(chats.filter(chat => chat.id !== id)); if (id === activeId) newChat(); }} />
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex items-center justify-between border-b px-5 py-4">
      <div><h1 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4" />Ask</h1><p className="mt-1 text-xs text-muted-foreground">Your knowledge, in conversation</p></div>
      <Tooltip content="Start a new chat"><button disabled={busy || !historyReady} onClick={newChat} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-hover disabled:opacity-40"><Plus className="size-4" />New chat</button></Tooltip>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5">
      {!messages.length ? <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-12">
        <h2 className="text-3xl font-semibold tracking-tight">What’s on your mind?</h2>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Ask anything. Explore your saved knowledge, connect ideas across articles, or trace an answer back to its sources.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">{suggestions.map(text => <button key={text} onClick={() => void send(text)} className="rounded-xl border p-4 text-left text-sm leading-6 transition-colors hover:bg-hover"><BookOpen className="mb-3 size-4 text-muted-foreground" />{text}</button>)}</div>
      </div> : <div className="mx-auto max-w-3xl space-y-8 py-8" role="log" aria-label="Conversation">{messages.map((message, index) => <article key={index} className={message.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-sidebar px-5 py-3" : "pr-2"}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "Second Brain"}</p>
        <div className="whitespace-pre-wrap text-sm leading-7 break-words"><Answer content={message.content} references={message.references ?? []} /></div>
        {!!message.references?.length && <div className="mt-4 flex flex-wrap gap-2">{message.references.map(ref => <Link key={ref.id} href={ref.href} className="max-w-full truncate rounded-lg border px-3 py-2 text-xs hover:bg-hover">[{ref.id}] {ref.kind} · {ref.title}</Link>)}</div>}
      </article>)}{busy && <p role="status" className="animate-pulse text-sm text-muted-foreground">Searching your knowledge and preparing an answer…</p>}<div ref={bottom} /></div>}
    </div>
    <div className="mx-auto w-full max-w-3xl px-5 pt-3 pb-5">
      <fieldset disabled={busy} className="mb-3"><legend className="mb-1 text-panel text-muted-foreground">Answer in context</legend><OptionSelect label="Answer in context" value={entityId} emptyLabel="All knowledge" options={(entities.data ?? []).filter(entity => !entity.merged_into_id).map(entity => ({ value: entity.id, label: `${entity.name} (${entity.type})` }))} onChange={setEntityId} /></fieldset>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} Your question is ready to retry.</p>}
      {warning && <p role="status" className="mb-3 text-xs text-muted-foreground">{warning}</p>}
      {storageError && <p role="alert" className="mb-3 text-xs text-destructive">{storageError}</p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="rounded-2xl border bg-sidebar p-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <textarea ref={input} aria-label="Message Ask" placeholder="Ask your second brain…" value={draft} onChange={event => setDraft(event.target.value)} maxLength={8000} rows={2} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="max-h-40 w-full resize-none bg-transparent px-1 py-2 text-sm outline-none" />
        <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><BookOpen className="size-3.5" />Knowledge, articles & sources</span>
          <Tooltip content={busy ? "Stop waiting" : "Send message"}><button type={busy ? "button" : "submit"} onClick={busy ? () => controller.current?.abort() : undefined} disabled={!busy && !draft.trim()} aria-label={busy ? "Stop waiting" : "Send message"} className="flex size-9 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30">{busy ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}</button></Tooltip>
        </div>
      </form>
      <p className="mt-2 text-center text-xs text-muted-foreground">Check linked references for important details. Chat history is saved in this browser.</p>
    </div>
  </section></div>;
}

function Answer({ content, references }: { content: string; references: Reference[] }) {
  return content.split(/(\[[KAS]\d+\])/g).map((part, index) => {
    const ref = references.find(r => `[${r.id}]` === part);
    return ref ? <Link key={index} href={ref.href} className="font-medium underline underline-offset-4">{part}</Link> : part;
  });
}

