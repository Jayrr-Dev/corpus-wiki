import type { Metadata } from "next";
import { EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

// FONTS: Inter for text, a mono face for ids, hashes and dates (wired to tokens in globals.css)
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });
// BRAND TITLE: the logo's Monotype Garamond can't be served, so EB Garamond stands in where it isn't installed
const garamond = EB_Garamond({ subsets: ["latin"], weight: "400", variable: "--font-garamond" });

export const metadata: Metadata = {
  title: "Corpus Wiki",
  description: "Files become knowledge units; the wiki rewrites itself.",
};

// ROOT LAYOUT: fonts, tokens and client providers for every route
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class on <html> before React loads, so the server markup differs
    <html lang="en" className={`${inter.variable} ${mono.variable} ${garamond.variable}`} suppressHydrationWarning>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before React loads */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
