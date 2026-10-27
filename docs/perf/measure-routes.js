// ROUTE SPEED PROBE: paste into the browser console (or javascript_tool) on a signed-in
// page of the running app. It loads each route in a hidden iframe, waits until the network
// is quiet, then stores one line per route in window.__c. Read it with window.__c.join("\n").
// Edit `routes` to probe only your lane's pages.
window.__c = [];
(async () => {
  const routes = ["/", "/assets", "/changes", "/decisions", "/domains", "/entities", "/errors", "/exceptions", "/glossary", "/graph", "/publishing", "/roles", "/settings", "/sources", "/stakeholders", "/units", "/upload", "/workflow", "/ask", "/explore"];
  for (const r of routes) {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:800px;opacity:0.01;pointer-events:none";
    document.body.appendChild(f);
    const t0 = performance.now();
    f.src = r;
    await new Promise((res) => (f.onload = res));
    const loadMs = Math.round(performance.now() - t0);
    let last = -1, stable = 0;
    const start = performance.now();
    while (performance.now() - start < 25000) {
      await new Promise((res) => setTimeout(res, 500));
      const n = f.contentWindow.performance.getEntriesByType("resource").length;
      if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; }
    }
    const es = f.contentWindow.performance.getEntriesByType("resource");
    const fetches = es.filter((e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest");
    const settle = Math.round(Math.max(0, ...es.map((e) => e.responseEnd)));
    const slow = fetches.sort((a, b) => b.duration - a.duration).slice(0, 3).map((e) => e.name.replace(location.origin, "").slice(0, 60) + "@" + Math.round(e.duration));
    window.__c.push(`${r} load=${loadMs} settle=${settle} fetch=${fetches.length} slow=${slow.join(" | ")}`);
    f.remove();
  }
  window.__c.push("DONE");
})();
