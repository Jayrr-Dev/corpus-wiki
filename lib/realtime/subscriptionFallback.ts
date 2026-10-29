// Keep saved-data views fresh when the live-update service is unavailable.
// Healthy subscriptions do not poll; reconnects refresh missed changes once.
// While disconnected each refresh doubles the wait (5 seconds up to a minute),
// so a struggling database is not hit by every open view at full speed.
const FIRST_POLL_MS = 5000;
const MAX_POLL_MS = 60_000;

export function subscriptionFallback(invalidate: () => void, visible: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wait = FIRST_POLL_MS;
  let disposed = false;
  let disconnected = false;
  const refresh = () => {
    if (disposed || !visible()) return false;
    invalidate();
    return true;
  };
  // A hidden tab keeps checking at the current pace; only a real refresh slows the next one
  const schedule = () => {
    timer = setTimeout(() => {
      if (refresh()) wait = Math.min(wait * 2, MAX_POLL_MS);
      schedule();
    }, wait);
  };
  const start = () => { if (!disposed && timer === undefined) schedule(); };
  const stop = () => { clearTimeout(timer); timer = undefined; wait = FIRST_POLL_MS; };
  start();
  return {
    status(status: string) {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        stop();
        if (disconnected) refresh();
        disconnected = false;
      } else { disconnected = true; start(); }
    },
    dispose() { disposed = true; stop(); },
  };
}
