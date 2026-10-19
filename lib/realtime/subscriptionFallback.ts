// Keep saved-data views fresh when the live-update service is unavailable.
// Healthy subscriptions do not poll; reconnects refresh missed changes once.
export function subscriptionFallback(invalidate: () => void, visible: () => boolean = () => true) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let disconnected = false;
  const refresh = () => { if (!disposed && visible()) invalidate(); };
  const start = () => { if (!disposed && timer === undefined) timer = setInterval(refresh, 5000); };
  const stop = () => { clearInterval(timer); timer = undefined; };
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
