import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";

// LANDING FONT: Geist only, per the landing page design rules; the logo keeps its Garamond
const geist = Geist({ subsets: ["latin"] });

const DESCRIPTION = "Corpus Wiki turns your business documents into linked claims that trace back to their source and update when a new version arrives.";

export const metadata: Metadata = {
  title: "Corpus Wiki | Business documents that are never out of date",
  description: DESCRIPTION,
  // TODO(launch): add an og:image once the share banner is made
  openGraph: { title: "Corpus Wiki", description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: "Corpus Wiki", description: DESCRIPTION },
};

// LANDING LAYOUT: follows the app theme; colours come from the landing tokens in globals.css
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${geist.className} min-h-svh bg-landing-base text-landing-ink antialiased`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>
      {children}
    </div>
  );
}
