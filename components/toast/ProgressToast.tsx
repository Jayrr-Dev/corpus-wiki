"use client";

import { Check, Minus, X } from "lucide-react";
import { useSyncExternalStore, type CSSProperties } from "react";
import { toast } from "sonner";
import { AtomGridCycle } from "@/components/standard/atom-grid";
import { Tooltip } from "@/components/standard/tooltip";

// =====================================================================
// PROGRESS TOAST: a card for a long-running process (AI writing,
// uploads, batch passes). It stays until the work finishes. The X
// collapses it into the corner dot loader without stopping the work.
// A click on those dots brings the card back. Each process is its own
// toast, so several running at once stack in the Toaster. One loader
// stands for every collapsed process.
// The bar is indeterminate until the caller knows a fraction (batches).
// With a delay, work that ends before it never shows a toast at all.
// On success it shows "Done" briefly; on failure it closes and the error
// toast (from ErrorNote) takes over.
// =====================================================================

// CORNER LOADER: 3 by 3 dots. The lift is the grid plus the button padding
// and a gap, so open toasts sit above it instead of on top of it.
const DOCK_SIZE = 3;
const DOCK_DOT = 6;
const DOCK_GAP = 3;
export const PROGRESS_DOCK_LIFT = DOCK_SIZE * DOCK_DOT + (DOCK_SIZE - 1) * DOCK_GAP + 8 + 12;

export type ProgressHandle = {
  // new detail line, and how far along (0–1) when it is known
  update: (detail: string, fraction?: number, title?: string) => void;
  done: (detail?: string) => void;
  fail: () => void;
};

// delayMs: wait this long before showing, so work that finishes quickly never flashes a toast
export type ProgressOptions = { delayMs?: number };

type ProgressState = { title: string; detail?: string; fraction?: number; finished: boolean };

const DONE_LINGER_MS = 4000;
let nextId = 0;

type DockEntry = { id: string; title: string; expand: () => void };

const dock = new Map<string, DockEntry>();
let dockSnapshot: DockEntry[] = [];
const dockListeners = new Set<() => void>();
const EMPTY_DOCK: DockEntry[] = [];

function publishDock() {
  dockSnapshot = [...dock.values()];
  for (const listener of dockListeners) listener();
}

function subscribeDock(listener: () => void) {
  dockListeners.add(listener);
  return () => { dockListeners.delete(listener); };
}

// COLLAPSED: processes whose card is hidden but still running
export function useCollapsedProgress() {
  return useSyncExternalStore(subscribeDock, () => dockSnapshot, () => EMPTY_DOCK);
}

// START: shows the toast (now, or after the delay) and returns the handle that moves it along
export function startProgress(title: string, detail?: string, options: ProgressOptions = {}): ProgressHandle {
  const id = `progress-${++nextId}`;
  let latest: ProgressState = { title, detail, finished: false };
  let visible = false;
  let collapsed = false;
  let closed = false;
  const expand = () => {
    if (closed || latest.finished) return;
    collapsed = false;
    dock.delete(id);
    publishDock();
    render();
  };
  const collapse = () => {
    if (closed || collapsed || latest.finished) return;
    collapsed = true;
    visible = false;
    dock.set(id, { id, title: latest.title, expand });
    publishDock();
    toast.dismiss(id);
  };
  const render = () => {
    if (collapsed) return;
    if (closed) {
      if (!latest.finished) return;
    }
    visible = true;
    toast.custom(() => (
      <ProgressCard
        {...latest}
        onClose={() => {
          if (latest.finished) {
            closed = true;
            toast.dismiss(id);
            return;
          }
          collapse();
        }}
      />
    ), {
      id,
      duration: latest.finished ? DONE_LINGER_MS : Infinity,
      onDismiss: () => {
        if (latest.finished || closed) return;
        collapse();
      },
    });
  };
  const timer = options.delayMs ? window.setTimeout(render, options.delayMs) : null;
  if (!timer) render();
  const forget = () => {
    if (!dock.has(id)) return;
    dock.delete(id);
    publishDock();
  };
  const set = (state: ProgressState) => {
    latest = state;
    if (collapsed) {
      const current = dock.get(id);
      if (current) {
        if (current.title !== latest.title) {
          dock.set(id, { id, title: latest.title, expand });
          publishDock();
        }
      }
      return;
    }
    if (visible) render();
  };
  return {
    update: (next, fraction, nextTitle) => { if (!closed) set({ title: nextTitle ?? latest.title, detail: next, fraction, finished: false }); },
    done: (next) => {
      if (closed) return;
      closed = true;
      if (timer) window.clearTimeout(timer);
      forget();
      // Collapsed, or never shown (finished within the delay): nothing to pop back up
      if (collapsed || !visible) return;
      set({ title: latest.title, detail: next ?? "Done", fraction: 1, finished: true });
    },
    fail: () => {
      if (closed) return;
      closed = true;
      collapsed = false;
      if (timer) window.clearTimeout(timer);
      forget();
      if (visible) toast.dismiss(id);
    },
  };
}

// DOCK: the corner loader. One button for every collapsed process. A click opens their cards again.
export function ProgressDock({ items }: { items: DockEntry[] }) {
  if (items.length === 0) return null;
  let label = `${items.length} still running`;
  if (items.length === 1) {
    const only = items[0];
    if (only) label = only.title;
  }
  return (
    <div className="fixed right-10 bottom-6 z-50">
      <Tooltip content={label} side="left" align="end">
        <button
          type="button"
          aria-label={label}
          onClick={() => { for (const item of items) item.expand(); }}
          className="cursor-pointer rounded-md p-1 text-text hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
        >
          <AtomGridCycle size={DOCK_SIZE} dot={DOCK_DOT} gap={DOCK_GAP} cycles={1} decorative className="pointer-events-none" />
        </button>
      </Tooltip>
    </div>
  );
}

// WRAP: shows the toast for as long as `work` runs; `ok` decides done vs fail
export async function withProgress<T>(
  title: string,
  detail: string | undefined,
  work: () => Promise<T>,
  ok: (result: T) => boolean = () => true,
  options: ProgressOptions = {},
): Promise<T> {
  const progress = startProgress(title, detail, options);
  try {
    const result = await work();
    if (ok(result)) progress.done();
    else progress.fail();
    return result;
  } catch (error) {
    progress.fail();
    throw error;
  }
}

function ProgressCard({ title, detail, fraction, finished, onClose }: ProgressState & { onClose: () => void }) {
  const percent = fraction === undefined ? undefined : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="flex w-74 flex-col gap-2" role="status" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-medium">
            {finished ? <Check className="size-3.5 text-applied" aria-hidden="true" /> : null}
            <span className="truncate">{title}</span>
          </p>
          {detail ? <p className="line-clamp-3 break-words whitespace-pre-line text-muted-foreground">{detail}</p> : null}
        </div>
        <button type="button" aria-label={finished ? "Close" : "Collapse"} onClick={onClose} className="-mr-1 -mt-0.5 rounded p-0.5 text-faint hover:bg-hover hover:text-text">
          {finished ? <X className="size-3.5" aria-hidden="true" /> : <Minus className="size-3.5" aria-hidden="true" />}
        </button>
      </div>
      <div
        className="relative h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        {percent === undefined
          ? <div className="sb-progress-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-text" />
          : <div className="h-full w-(--progress) rounded-full bg-text transition-all duration-300" style={{ "--progress": `${percent}%` } as CSSProperties} />}
      </div>
    </div>
  );
}
