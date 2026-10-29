"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useLayoutEffect } from "react";
import { GlossaryScreen } from "@/app/(app)/glossary/GlossaryScreen";
import { Camera, easeOut, keyframes, lerp, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { glossaryLetter } from "@/lib/glossary/entries";
import { GLOSSARY_ENTRIES, GLOSSARY_VIEW } from "@/lib/video-stage/phoenix/connect";

// GLOSSARY: the real Glossary screen, seeded ready, its terms popping in one after another
// in quick succession. 1.4 seconds, starting mid-motion (the first term is already landing).

const DURATION = 1.4;
// When the first term starts, the gap between terms, and how long one takes to land
const FIRST = -0.1;
const GAP = 0.17;
const POP = 0.3;

// The reading pane scrolls down as the later terms land: [time, scrollTop]
const SCROLL: [number, number][] = [[0.15, 0], [1.4, 720]];

// GlossaryScreen's own module-private key for readGlossaryView
const QUERY_KEY = ["glossary", "dictionary"];

// The screen files terms under their letters, so they pop in top to bottom
const LETTERS = GLOSSARY_ENTRIES.map((entry) => glossaryLetter(entry.term)).sort();

// One rule per term: each letter section holds one term here, so the section pops in whole
function popStyles(t: number): string {
  return LETTERS.map((letter, index) => {
    const p = easeOut(seg(t, FIRST + index * GAP, FIRST + index * GAP + POP));
    return `[data-stage-frame] section[aria-label="Letter ${letter}"] { opacity: ${p.toFixed(3)}; transform: translateY(${lerp(18, 0, p).toFixed(1)}px) scale(${lerp(0.97, 1, p).toFixed(4)}); transform-origin: 0 50%; }`;
  }).join("\n");
}

function Glossary({ t }: { t: number }) {
  // The shell's scrolling <main> (inside the sidebar's own <main>); set it for this frame before the screenshot
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>("[data-stage-frame] main.overflow-y-auto");
    if (main) main.scrollTop = keyframes(t, SCROLL);
  }, [t]);
  return (
    // The glossary-inputs read stays unseeded on purpose: once it has rows the screen asks the server to regenerate
    <StageProviders seed={(qc) => qc.setQueryData(QUERY_KEY, GLOSSARY_VIEW)}>
      <style>{popStyles(t)}</style>
      <Camera t={t} keys={[[0, 1.03, 1100, 420], [DURATION, 1.08, 1100, 420]]}>
        <StageShell title="Glossary">
          <GlossaryScreen />
        </StageShell>
      </Camera>
    </StageProviders>
  );
}

export const glossary: Scene = { duration: DURATION, Component: Glossary, title: "Glossary" };
