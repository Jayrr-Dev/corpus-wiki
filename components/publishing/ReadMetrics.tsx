"use client";

import { useEffect, useRef } from "react";

// No cross-site cookies or persistent visitor profile. A tab gets a random ID
// for the current UTC day. Blocked storage and tracking preferences are honored.
export function ReadMetrics({ ticket }: { ticket: string }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    let visitor: string;
    try {
      const key = "wiki-reading-session";
      const date = new Date().toISOString().slice(0, 10);
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { date?: string; id?: string } | null;
      visitor = saved?.date === date && saved.id ? saved.id : crypto.randomUUID();
      sessionStorage.setItem(key, JSON.stringify({ date, id: visitor }));
    } catch { return; }
    let onScreen = false, started = false, seconds = 0, engaged = false;
    const send = (kind: "view" | "engaged") => {
      void fetch("/api/public-wiki/metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, visitor, kind }), keepalive: true }).catch(() => undefined);
    };
    // The enclosing reader fills the frame; observe it rather than a tiny pixel
    // that would stop being visible as soon as the visitor scrolls.
    const observed = marker.current?.parentElement;
    const observer = new IntersectionObserver(entries => { onScreen = entries.some(e => e.isIntersecting); });
    if (observed) observer.observe(observed);
    const timer = window.setInterval(() => {
      if (!onScreen || document.visibilityState !== "visible") return;
      if (!started) { started = true; send("view"); }
      if (!engaged && ++seconds >= 30) { engaged = true; send("engaged"); }
    }, 1000);
    return () => { window.clearInterval(timer); observer.disconnect(); };
  }, [ticket]);
  return <div ref={marker} aria-hidden="true" />;
}
