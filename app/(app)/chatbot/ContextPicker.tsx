"use client";

import { useState } from "react";
import { BookOpen, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip } from "@/components/standard/tooltip";

type ContextOption = { id: string; name: string; type: string };

export function ContextPicker({ value, options, onChange, disabled, loading, failed }: {
  value: string;
  options: ContextOption[];
  onChange: (value: string) => void;
  disabled: boolean;
  loading: boolean;
  failed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find(option => option.id === value);
  const filtered = options.filter(option => `${option.name} ${option.type}`.toLowerCase().includes(query.trim().toLowerCase()));

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  return <Dialog open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(""); }}>
    <Tooltip content="Choose the knowledge to use for answers">
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="min-w-0 max-w-64 justify-start" aria-label={`Answer context: ${selected?.name ?? "All knowledge"}. Change context`}>
          <BookOpen className="size-3.5" /><span className="truncate">{selected?.name ?? "All knowledge"}</span>
        </Button>
      </DialogTrigger>
    </Tooltip>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Answer in context</DialogTitle>
        <DialogDescription>Use everything you’ve saved, or focus on a specific topic.</DialogDescription>
      </DialogHeader>
      <label className="flex items-center gap-2 rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input aria-label="Search topics" placeholder="Search topics…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-panel outline-none" />
      </label>
      <Button type="button" variant={value === "" ? "secondary" : "ghost"} disabled={disabled} onClick={() => choose("")} className="justify-start" aria-pressed={value === ""}>
        <BookOpen /><span className="flex-1 text-left">All knowledge</span>{value === "" && <Check />}
      </Button>
      <div className="max-h-[min(18rem,40dvh)] space-y-1 overflow-y-auto border-t pt-2" aria-label="Topics">
        {loading ? <p role="status" className="p-3 text-muted-foreground">Loading topics…</p> : failed ? <p role="status" className="p-3 text-muted-foreground">Topics couldn’t be loaded. You can still use all knowledge.</p> : filtered.length ? filtered.map(option => <button key={option.id} type="button" disabled={disabled} onClick={() => choose(option.id)} aria-pressed={value === option.id} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-panel hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${value === option.id ? "bg-secondary" : ""}`}>
          <span className="min-w-0 flex-1 text-left"><span className="block break-words">{option.name}</span><span className="block text-xs font-normal text-muted-foreground">{option.type}</span></span>{value === option.id && <Check />}
        </button>) : <p className="p-3 text-muted-foreground">{query ? "No matching topics." : "Your saved topics will appear here."}</p>}
      </div>
    </DialogContent>
  </Dialog>;
}

