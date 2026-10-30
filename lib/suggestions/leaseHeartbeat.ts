// Keeps a suggestion's lease alive while it is applied. A new article gives its lease back when
// the suggestion is marked applied, then goes on writing: `release` ends the beat first, so
// a renewal that finds the lease gone (one already on its way included) stops nothing.
export function leaseHeartbeat(renew: () => Promise<void>, onLost: (failure: unknown) => void, everyMs: number) {
  let released = false;
  const beat = setInterval(() => {
    void renew().catch((failure) => { if (!released) onLost(failure); });
  }, everyMs);
  beat.unref?.();
  return { release() { released = true; clearInterval(beat); } };
}
