"use client";

import { Check, X } from "lucide-react";
import type { CSSProperties } from "react";
import { toast } from "sonner";

// =====================================================================
// PROGRESS TOAST: a card for a long-running process (AI writing,
// uploads, batch passes). It stays until the work finishes; the X hides
// it early without stopping the work. Each process is its own toast, so
// several running at once stack in the Toaster.
// The bar is indeterminate until the caller knows a fraction (batches).
// With a delay, work that ends before it never shows a toast at all.
// On success it shows "Done" briefly; on failure it closes and the error
// toast (from ErrorNote) takes over.
// =====================================================================

export type ProgressHandle = {
  // new detail line, and how far along (0–1) when it is known
  update: (detail: string, fraction?: number) => void;
  done: (detail?: string) => void;
  fail: () => void;
};

// delayMs: wait this long before showing, so work that finishes quickly never flashes a toast
export type ProgressOptions = { delayMs?: number };

type ProgressState = { title: string; detail?: string; fraction?: number; finished: boolean };

const DONE_LINGER_MS = 4000;
let nextId = 0;

// START: shows the toast (now, or after the delay) and returns the handle that moves it along
export function startProgress(title: string, detail?: string, options: ProgressOptions = {}): ProgressHandle {
  const id = `progress-${++nextId}`;
  let latest: ProgressState = { title, detail, finished: false };
  let visible = false;
  let dismissed = false;
  let closed = false;
  const render = () => {
    if (dismissed) return;
    visible = true;
    toast.custom(() => <ProgressCard {...latest} onClose={() => { dismissed = true; toast.dismiss(id); }} />, {
      id,
      duration: latest.finished ? DONE_LINGER_MS : Infinity,
      onDismiss: () => { dismissed = true; },
    });
  };
  const timer = options.delayMs ? window.setTimeout(render, options.delayMs) : null;
  if (!timer) render();
  const set = (state: ProgressState) => {
    latest = state;
    if (visible) render();
  };
  return {
    update: (next, fraction) => { if (!closed) set({ title, detail: next, fraction, finished: false }); },
    done: (next) => {
      if (closed) return;
      closed = true;
      if (timer) window.clearTimeout(timer);
      // Never shown (finished within the delay): nothing to say
      set({ title, detail: next ?? "Done", fraction: 1, finished: true });
    },
    fail: () => {
      if (closed) return;
      closed = true;
      if (timer) window.clearTimeout(timer);
      if (visible) toast.dismiss(id);
    },
  };
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
          {detail ? <p className="line-clamp-3 break-words text-muted-foreground">{detail}</p> : null}
        </div>
        <button type="button" aria-label="Hide" onClick={onClose} className="-mr-1 -mt-0.5 rounded p-0.5 text-faint hover:bg-hover hover:text-text">
          <X className="size-3.5" aria-hidden="true" />
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
