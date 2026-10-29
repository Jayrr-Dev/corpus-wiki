"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// DEMO EMBED: one approved landing demo (public/landing-demos/concept-<n>.html)
// in embed mode, sized to its content. The demo page posts its height as it
// changes. Fast path until each demo is ported to React (see TODO.md).
export function DemoEmbed({ concept, title, minHeight = 560, className }: { concept: number; title: string; minHeight?: number; className?: string }) {
  const src = `/landing-demos/concept-${concept}.html`;
  const [height, setHeight] = useState(minHeight);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { landingDemo?: string; height?: number } | null;
      if (data?.landingDemo === src && typeof data.height === "number" && data.height > 0) setHeight(Math.ceil(data.height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src]);

  return (
    <iframe
      src={`${src}?embed`}
      title={title}
      loading="lazy"
      scrolling="no"
      style={{ height }}
      className={cn("demo-edge-fade block w-full border-0 bg-transparent", className)}
    />
  );
}
