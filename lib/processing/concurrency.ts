export async function mapConcurrent<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Concurrency must be a positive integer.");
  signal?.throwIfAborted();
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    try {
      while (!failed && next < items.length) {
        signal?.throwIfAborted();
        const index = next++;
        results[index] = await run(items[index]!, index);
      }
    } catch (error) {
      if (!failed) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
  signal?.throwIfAborted();
  return results;
}

// FIFO, shared by concurrent requests in one server process. A cancelled waiter
// is removed immediately rather than consuming a slot or blocking the next one.
export class RequestPool {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Concurrency must be a positive integer.");
  }
  async run<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = this.waiters.indexOf(start);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason ?? new Error("Cancelled"));
      };
      const start = () => {
        signal?.removeEventListener("abort", abort);
        this.active++;
        resolve();
      };
      if (this.active < this.limit) start();
      else { this.waiters.push(start); signal?.addEventListener("abort", abort, { once: true }); }
    });
    try { signal?.throwIfAborted(); return await run(); }
    finally { this.active--; this.waiters.shift()?.(); }
  }
}
