// Work may start early, but consumption remains in document order. A result is
// usable only against exactly the context it was requested with (or a previously
// accepted durable checkpoint). Dependent context changes force a fresh read.
export async function forEachLookahead<T, R>(items: readonly T[], options: {
  context: () => string;
  read: (item: T, context: string, signal: AbortSignal) => Promise<{ value: R; checkpoint?: boolean }>;
  consume: (item: T, value: R) => Promise<void>;
  limit?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
  type Result = { ok: true; value: { value: R; checkpoint?: boolean } } | { ok: false; error: unknown };
  const pending = new Map<number, { context: string; result: Promise<Result> }>();
  let next = 0, stale = 0;
  let limit = Math.max(1, Math.min(options.limit ?? 2, 3));
  const start = (index: number) => {
    const context = options.context();
    pending.set(index, { context, result: options.read(items[index]!, context, signal)
      .then((value): Result => ({ ok: true, value }), (error): Result => ({ ok: false, error })) });
  };
  try {
    for (let index = 0; index < items.length; index++) {
      signal.throwIfAborted();
      while (next < items.length && pending.size < limit) start(next++);
      const entry = pending.get(index)!;
      let result = await entry.result;
      pending.delete(index);
      const context = options.context();
      if (entry.context !== context && !(result.ok && result.value.checkpoint)) {
        // Documents rich in cross-batch procedures benefit less from speculation.
        // Stop looking ahead after repeated invalidations to bound wasted work.
        if (++stale >= 2) limit = 1;
        result = await options.read(items[index]!, context, signal)
          .then((value): Result => ({ ok: true, value }), (error): Result => ({ ok: false, error }));
      }
      if (!result.ok) throw result.error;
      await options.consume(items[index]!, result.value.value);
    }
  } catch (error) {
    abort.abort(error);
    throw error;
  } finally {
    await Promise.all([...pending.values()].map((entry) => entry.result));
  }
}
