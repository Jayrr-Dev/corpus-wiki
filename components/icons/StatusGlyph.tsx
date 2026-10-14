import type { ReactNode } from "react";
import type { Enums } from "@/lib/database/types";
import { cn } from "@/lib/utils";
import { IconBase, type IconProps } from "./IconBase";

type EpistemicStatus = Enums<"epistemic_status">;

// GLYPH SHAPES: certainty is told by fill, so it still reads in grayscale
const GLYPHS: Record<EpistemicStatus, () => ReactNode> = {
  // established: filled circle
  established: () => <circle cx="8" cy="8" r="5" fill="currentColor" />,
  // supported: ring + big dot
  supported: () => (
    <>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  // assumed: ring + small dot
  assumed: () => (
    <>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  // hypothesis: dashed ring
  hypothesis: () => <circle cx="8" cy="8" r="5" strokeDasharray="2.6 1.6" strokeLinecap="butt" />,
  // disputed: left half filled
  disputed: () => (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3a5 5 0 0 0 0 10z" fill="currentColor" stroke="none" />
    </>
  ),
  // unknown: dotted ring
  unknown: () => <circle cx="8" cy="8" r="5" strokeDasharray="0.01 2.6" />,
};

// STATUSES DRAWN IN THE "HYPOTHESIS, DISPUTED OR STALE" ACCENT
const ACCENTED: ReadonlySet<EpistemicStatus> = new Set(["hypothesis", "disputed"]);

export type StatusGlyphProps = IconProps & { status: EpistemicStatus };

// STATUS GLYPH: one unit's epistemic status as a 16px mark, labelled for screen readers
export function StatusGlyph({ status, className, ...props }: StatusGlyphProps) {
  const Glyph = GLYPHS[status];
  return (
    <IconBase
      role="img"
      aria-label={status}
      className={cn(ACCENTED.has(status) && "text-stale", className)}
      {...props}
    >
      <title>{status}</title>
      <Glyph />
    </IconBase>
  );
}
