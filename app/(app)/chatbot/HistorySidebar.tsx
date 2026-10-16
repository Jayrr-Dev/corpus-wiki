"use client";

import { useState } from "react";
import { MessageCircle, Minus, Plus, Search, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import type { SavedChat } from "./history";

export function HistorySidebar({ chats, activeId, busy, onSelect, onDelete, onNew }: { chats: SavedChat[]; activeId: string | null; busy: boolean; onSelect: (chat: SavedChat) => void; onDelete: (id: string) => void; onNew: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = chats.filter(chat => chat.title.toLowerCase().includes(query.toLowerCase()));
  return <aside aria-label="Chat history" className={`relative shrink-0 p-2 pr-0 ${collapsed ? "w-10" : "w-10 md:w-52 lg:w-64"}`}>
    {collapsed ? <div className="flex flex-col items-center gap-2"><Tooltip content="Expand chat history"><Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(false)} aria-label="Expand chat history"><Square className="size-4" /></Button></Tooltip><Tooltip content="Start a new chat"><Button variant="ghost" size="icon-sm" disabled={busy} onClick={onNew} aria-label="Start a new chat"><Plus className="size-4" /></Button></Tooltip></div> : <div className="absolute top-2 bottom-2 left-2 z-20 flex w-64 flex-col rounded-lg border bg-sidebar p-2 shadow-sm md:static md:h-full md:w-auto">
      <div className="flex items-center justify-between px-2 py-2"><h2 className="text-sm font-semibold">Chat history</h2><Tooltip content="Minimize chat history"><button onClick={() => setCollapsed(true)} aria-label="Minimize chat history" className="p-1 text-muted-foreground hover:text-foreground"><Minus className="size-4" /></button></Tooltip></div>
      <Button onClick={onNew} disabled={busy} variant="outline" className="mb-3 justify-start"><Plus className="size-4" />New chat</Button>
      <label className="mb-2 flex items-center gap-2 rounded-md border px-2 py-2"><Search className="size-3.5 shrink-0 text-muted-foreground" /><input aria-label="Search chat history" placeholder="Search chats…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
      <div className="min-h-0 flex-1 overflow-y-auto">{filtered.map(chat => <div key={chat.id} className={`group flex items-center rounded-md ${activeId === chat.id ? "bg-hover" : "hover:bg-hover"}`}>
        <button disabled={busy} onClick={() => onSelect(chat)} aria-current={activeId === chat.id ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left text-xs disabled:opacity-40"><MessageCircle className="size-3.5 shrink-0" /><span className="truncate">{chat.title}</span></button>
        <Tooltip content="Delete chat"><button disabled={busy} onClick={() => onDelete(chat.id)} aria-label={`Delete chat: ${chat.title}`} className="mr-1 rounded p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-40"><Trash2 className="size-3.5" /></button></Tooltip>
      </div>)}{!filtered.length && <p className="px-2 py-5 text-xs leading-5 text-muted-foreground">{query ? "No matching chats." : "Your conversations will appear here."}</p>}</div>
      <p className="border-t px-2 pt-3 pb-1 text-xs text-muted-foreground">Saved in this browser</p>
    </div>}
  </aside>;
}
