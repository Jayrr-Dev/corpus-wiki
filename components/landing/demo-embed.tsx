"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A demo that never signals ready still loses the panel this long after it loads
const READY_FALLBACK_MS = 1500;

// DEMO EMBED: one approved landing demo (public/landing-demos/concept-<n>.html)
// in embed mode, sized to its content. The demo page posts its height as it
// changes, and that it is ready (demo-runtime.js). Fast path until each demo is
// ported to React (see TODO.md).
// `eager` is for a demo above the fold; the rest load as they near the screen.
// The loading panel sits behind the see-through frame, so the demo still shows
// when this script is slow or fails.
export function DemoEmbed({ concept, title, minHeight = 560, eager = false, className }: { concept: number; title: string; minHeight?: number; eager?: boolean; className?: string }) {
  const src = `/landing-demos/concept-${concept}.html`;
  const [height, setHeight] = useState(minHeight);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { landingDemo?: string; height?: number; ready?: boolean } | null;
      if (data?.landingDemo !== src) return;
      if (data.ready) setReady(true);
      if (typeof data.height === "number" && data.height > 0) setHeight(Math.ceil(data.height));
    };
    window.addEventListener("message", onMessage);
    // A demo can finish before this page starts listening
    if (frame.current?.contentDocument?.documentElement.dataset.demoReady) setReady(true);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(fallback.current);
    };
  }, [src]);

  return (
    <div className={cn("relative", className)} style={{ height }}>
      <div
        aria-hidden
        className={cn(
          "absolute inset-6 grid place-items-center rounded-2xl border border-landing-ink/10 bg-landing-ink/[0.03] text-sm text-landing-ink/50 transition-opacity duration-300 ease-landing",
          ready ? "pointer-events-none opacity-0" : "motion-safe:animate-pulse",
        )}
      >
        Loading demo…
      </div>
      <iframe
        ref={frame}
        src={`${src}?embed`}
        title={title}
        loading={eager ? "eager" : "lazy"}
        scrolling="no"
        onLoad={() => { fallback.current = setTimeout(() => setReady(true), READY_FALLBACK_MS); }}
        className="demo-edge-fade relative block h-full w-full border-0 bg-transparent"
      />
    </div>
  );
}
