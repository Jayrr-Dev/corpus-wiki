import { cn } from "@/lib/utils";

// =====================================================================
// CORPUS WIKI BRAND: the open-margin mark and the horizontal logo.
// Source artwork lives in docs/brand/corpus-wiki; web copies in public/brand/corpus-wiki.
// =====================================================================

const MARK_PATH = "M12 18C30 18 42 26 50 38C58 26 70 18 88 18V35C76 35 65 41 56 47V62C65 55 76 52 88 52V64C71 64 59 72 50 86C41 72 29 64 12 64V52C24 52 35 55 44 62V47C35 41 24 35 12 35Z";

// BRAND MARK: inline so it takes the brand token's light or dark green (size it with className)
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="5 11 90 82" className={cn("size-4 shrink-0 text-brand", className)}>
      <path fill="currentColor" d={MARK_PATH} />
    </svg>
  );
}

// BRAND LOGO: mark and Garamond wordmark; the white artwork replaces the charcoal one in dark mode
export function BrandLogo({ className }: { className?: string }) {
  const art = "/brand/corpus-wiki/Corpus-Wiki-Horizontal-RGB";
  return (
    <span role="img" aria-label="Corpus Wiki" className={cn("inline-flex h-8", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing */}
      <img src={`${art}-Full-Colour.svg`} alt="" className="h-full w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
      <img src={`${art}-White.svg`} alt="" className="hidden h-full w-auto dark:block" />
    </span>
  );
}
