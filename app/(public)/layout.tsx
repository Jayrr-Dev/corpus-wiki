import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Published wiki | Second Brain", robots: { index: false, follow: false, nocache: true } };
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <><a href="#wiki-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-background focus:p-3">Skip to content</a>{children}</>;
}
