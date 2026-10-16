"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { EXCEPTION_TONE } from "@/app/(app)/_lib/tone";
import { asObject, describeActionInput, readString, readStrings } from "@/app/(app)/_lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_OF_REASON, CATEGORY_TABS, type CategoryTab } from "./categories";
import { exceptionTitle } from "./ExceptionCard";
import { ExceptionReview } from "./ExceptionReview";
import { INBOX_PAGE_SIZE, useExceptionCounts, useExceptionInbox, type InboxRow, type InboxStatus } from "./useExceptionInbox";

export function ExceptionInbox() {
  const [status, setStatus] = useState<InboxStatus>("open");
  const [category, setCategory] = useState<CategoryTab>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [oldestFirst, setOldestFirst] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ row: InboxRow; slot: number } | null>(null);
  const counts = useExceptionCounts();
  const query = useExceptionInbox(status, category, page, appliedSearch, oldestFirst);
  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
  const waiting = query.isPending || search !== appliedSearch;
  useEffect(() => {
    if (search === appliedSearch) return;
    const timer = window.setTimeout(() => { setAppliedSearch(search); setPage(0); setSelected(null); }, 300);
    return () => window.clearTimeout(timer);
  }, [search, appliedSearch]);
  // Resolving the final item on a page can shrink the inbox by a page.
  if (query.data && page >= pages) setPage(pages - 1);
  const resetSelection = () => { setPage(0); setSelected(null); };
  const select = (index: number) => { if (rows[index]) setSelected({ row: rows[index], slot: index }); };
  const selectedIndex = selected ? rows.findIndex((row) => row.exception.id === selected.row.exception.id) : -1;
  // A resolved item may leave Open. Keep its confirmation visible and let Next
  // select the item that moved into its slot, rather than skipping that item.
  const nextIndex = selectedIndex >= 0 ? selectedIndex + 1 : selected?.slot ?? 0;
  const previousIndex = (selectedIndex >= 0 ? selectedIndex : selected?.slot ?? 0) - 1;
  const changePage = (next: number) => { setPage(next); setSelected(null); };

  return <div className="flex flex-col gap-4">
    <p className="text-panel text-muted-foreground">Review proposed changes one at a time. Open an item to compare the evidence before deciding.</p>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b">
      <div className="flex gap-4" aria-label="Exception status">
        {(["open", "answered"] as const).map((view) => <button key={view} type="button" aria-pressed={status === view}
          onClick={() => { setStatus(view); setOldestFirst(view === "open"); resetSelection(); }}
          className={cn("border-b-2 px-1 py-3 text-panel", status === view ? "border-foreground font-medium" : "border-transparent text-muted-foreground")}>
          {view === "open" ? "Needs review" : "Answered"} <span className="ml-1 tabular-nums text-muted-foreground">{counts.data?.[view] ?? ""}</span>
        </button>)}
      </div>
      {counts.error ? <span className="text-xs text-muted-foreground">Totals unavailable</span> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Search evidence, domains, or notes…" aria-label="Search exceptions" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-52 flex-1" />
      <NativeSelect aria-label="Exception category" value={category} onChange={(event) => { setCategory(event.target.value as CategoryTab); resetSelection(); }}>
        {CATEGORY_TABS.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.id === "all" ? "All categories" : item.label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect aria-label="Exception order" value={oldestFirst ? "oldest" : "newest"} onChange={(event) => { setOldestFirst(event.target.value === "oldest"); resetSelection(); }}>
        <NativeSelectOption value="oldest">Oldest first</NativeSelectOption><NativeSelectOption value="newest">Newest first</NativeSelectOption>
      </NativeSelect>
      {(search || category !== "all") ? <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setAppliedSearch(""); setCategory("all"); resetSelection(); }}>Clear filters</Button> : null}
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
      <section data-tour="exceptions-inbox" aria-label="Exception inbox" className={cn("overflow-hidden rounded-lg border", selected && "hidden lg:block")}>
        <div className="border-b bg-sidebar px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {waiting ? "Loading exceptions…" : total ? `${page * INBOX_PAGE_SIZE + 1}–${Math.min((page + 1) * INBOX_PAGE_SIZE, total)} of ${total}` : "No exceptions"}
        </div>
        {query.error ? <div className="space-y-2 p-4" role="alert"><p>Could not load exceptions: {query.error.message}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button></div>
          : waiting ? <p className="p-6 text-panel text-muted-foreground" role="status">Loading your review queue…</p>
          : !rows.length ? <div className="space-y-2 p-6"><p className="font-medium">{search || category !== "all" ? "No matching exceptions" : status === "open" ? "You’re all caught up" : "No answered exceptions yet"}</p><p className="text-panel text-muted-foreground">{search || category !== "all" ? "Try another search or clear your filters." : status === "open" ? "New questions will appear here when a change needs your decision." : "Decisions you make will appear here."}</p></div>
          : <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {rows.map((row, index) => {
              const evidence = asObject(row.exception.evidence);
              const proposal = row.action ? asObject(row.action.input) : null;
              const categoryLabel = CATEGORY_TABS.find((tab) => tab.id === CATEGORY_OF_REASON[row.exception.reason])?.label;
              const description = (proposal && (readString(proposal, "content") || readString(proposal, "rationale") || readString(proposal, "reason")))
                || readString(evidence, "detail") || (row.action ? describeActionInput(row.action.type, row.action.input) : null);
              const domains = readStrings(evidence, "domainPaths");
              return <li key={row.exception.id}><button type="button" aria-current={selected?.row.exception.id === row.exception.id ? "true" : undefined} onClick={() => select(index)}
                className={cn("flex w-full flex-col gap-1.5 border-l px-3 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2", selected?.row.exception.id === row.exception.id ? "border-link bg-hover" : "border-transparent")}>
                <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground"><span>{categoryLabel}</span><StatusDot className="shrink-0" tone={EXCEPTION_TONE[row.exception.status]} label={row.exception.status === "open" ? "Needs review" : row.exception.status === "accepted" ? "Approved" : "Rejected"} /></span>
                <span className="line-clamp-2 text-panel font-medium">{exceptionTitle(row.exception, row.action)}</span>
                {description ? <span className="line-clamp-2 text-panel text-muted-foreground">{description}</span> : null}
                {domains.length ? <span className="truncate text-xs text-muted-foreground">{domains.join(" · ")}</span> : null}
                <span className="text-xs text-faint"><DateTime iso={row.exception.created_at} /></span>
              </button></li>;
            })}
          </ul>}
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="ghost" size="sm" disabled={waiting || page === 0} onClick={() => changePage(page - 1)} aria-label="Previous page"><ChevronLeft />Previous</Button>
          <span className="text-xs text-muted-foreground">{waiting ? "Loading…" : `${page + 1} / ${pages}`}</span>
          <Button variant="ghost" size="sm" disabled={waiting || page + 1 >= pages} onClick={() => changePage(page + 1)} aria-label="Next page">Next<ChevronRight /></Button>
        </div>
      </section>
      <section aria-label="Selected exception" className={cn("min-w-0 lg:sticky lg:top-4", !selected && "hidden lg:block")}>
        {selected ? <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}><ArrowLeft />Back to inbox</Button>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={waiting || previousIndex < 0} onClick={() => select(previousIndex)}>Previous item</Button>
              <Button variant="outline" size="sm" disabled={waiting || nextIndex >= rows.length} onClick={() => select(nextIndex)}>Next item</Button>
            </div>
          </div>
          <div key={selected.row.exception.id} className="max-h-[75vh] overflow-y-auto"><ExceptionReview row={selected.row} /></div>
        </> : <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center"><p className="font-medium">Select an exception to review</p><p className="mt-2 max-w-xs text-panel text-muted-foreground">The proposed change, supporting evidence, and decision controls will appear here.</p><Button variant="outline" size="sm" disabled={waiting || !rows.length} onClick={() => select(0)} className="mt-4">{status === "open" ? "Start reviewing" : "View first decision"}</Button></div>}
      </section>
    </div>
  </div>;
}
