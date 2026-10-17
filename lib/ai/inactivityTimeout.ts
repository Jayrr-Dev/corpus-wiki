export const AI_INACTIVITY_TIMEOUT_MS = 60_000;

export class AiInactivityError extends Error {
  constructor() {
    super("The AI sent no new output for 60 seconds. The update stopped; saved content is safe. Try Update again.");
    this.name = "AiInactivityError";
  }
}

// The abort signal stops the actual provider request; the race also bounds clients
// that fail to settle their promise after cancellation. Callers must not save drafts.
export async function withAiActivity<T>(run: (signal: AbortSignal, activity: () => void) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  let rejectIdle: (error: Error) => void;
  const expired = new Promise<never>((_, reject) => { rejectIdle = reject; });
  const activity = () => {
    if (closed || signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const error = new AiInactivityError();
      rejectIdle(error);
      controller.abort(error);
    }, AI_INACTIVITY_TIMEOUT_MS);
  };
  activity();
  try { return await Promise.race([run(signal, activity), expired]); }
  finally { closed = true; clearTimeout(timer!); }
}
