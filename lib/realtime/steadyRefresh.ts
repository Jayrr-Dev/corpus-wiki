// Keep saved-data views fresh without the database change feed: refresh on a steady timer while
// the tab is shown, and at once when it is shown again. A hidden tab never refreshes.
const REFRESH_MS = 10_000;

export function steadyRefresh(invalidate: () => void, visible: () => boolean = () => true, intervalMs = REFRESH_MS) {
  let disposed = false;
  const refresh = () => { if (!disposed && visible()) invalidate(); };
  const timer = setInterval(refresh, intervalMs);
  const onShown = () => { if (visible()) refresh(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShown);
  return {
    dispose() {
      disposed = true;
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShown);
    },
  };
}
