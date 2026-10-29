"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { Camera, Highlight, seg, StageProviders, StageShell, Toast, typed, type Scene } from "@/components/video-stage";
import { articleEvidence, CAB_APRIL, DEPLOY_WINDOW_KEY, DEPLOY_WINDOW_NEW, lineId, RUNBOOK, RUNBOOK_SETTLED, shownLine, shownLines } from "@/lib/video-stage/phoenix/article";
import { typingCss, WikiArticle } from "./wiki";

// =====================================================================
// REWRITE: "Drop in a newer file, and it only rewrites the lines that
// changed." The finished runbook; a toast reports April's CAB minutes
// (0.2 to 2.6); only the deploy-window line flashes (1.0), strikes
// through (1.35) and is retyped with the new window (1.75 to 2.45), its
// new citation showing at 2.5. The camera pushes in on that line.
// =====================================================================

const DEPLOY = lineId(RUNBOOK, DEPLOY_WINDOW_KEY);
const INDEX = RUNBOOK.lines.findIndex((line) => line.key === DEPLOY_WINDOW_KEY);
// frame pixels, measured on the stage: the deploy-window paragraph
const LINE = { x: 773, y: 306, w: 800, h: 56 };
const FLASH = 1.0;
const STRIKE = [1.35, 1.7] as const;
const RETYPE = [1.75, 2.45] as const;

// The flash (a gold wash that rises and falls) and the strike (a rule drawn left to right through the words)
function rewriteCss(t: number): string {
  const flash = Math.sin(Math.PI * seg(t, FLASH, STRIKE[1])) * 0.32;
  const strike = seg(t, STRIKE[0], STRIKE[1]);
  const struck = t >= STRIKE[0] && t < RETYPE[0];
  return `#line-${DEPLOY} { background-color: color-mix(in oklab, var(--color-stale) ${Math.round(flash * 100)}%, transparent) !important; border-radius: 4px; }`
    + (struck ? ` #line-${DEPLOY} > span { color: color-mix(in oklab, currentColor ${Math.round(100 - strike * 45)}%, transparent); background-image: linear-gradient(var(--color-stale), var(--color-stale)); background-size: ${strike * 100}% 2px; background-position: 0 58%; background-repeat: no-repeat; }` : "");
}

function Rewrite({ t }: { t: number }) {
  const retyping = t >= RETYPE[0];
  const done = t >= RETYPE[1] + 0.05;
  const article = retyping ? RUNBOOK_SETTLED : RUNBOOK;
  const lines = shownLines(article);
  if (retyping) lines[INDEX] = shownLine(article, DEPLOY_WINDOW_NEW, INDEX, typed(DEPLOY_WINDOW_NEW.text, seg(t, RETYPE[0], RETYPE[1])));
  const evidence = articleEvidence(article, lines);
  const center = { x: LINE.x + LINE.w / 2, y: LINE.y + LINE.h / 2 };
  return (
    <StageProviders>
      <style>{rewriteCss(t) + (retyping && !done ? `${typingCss(DEPLOY)} #line-${DEPLOY} { min-height: ${LINE.h}px; }` : "")}</style>
      <Camera t={t} keys={[[0.3, 1, center.x, center.y], [3.8, 1.22, center.x, center.y]]}>
        <StageShell>
          <WikiArticle article={article} lines={lines} evidence={evidence} />
        </StageShell>
        <Highlight t={t} from={2.5} to={4.3} x={LINE.x - 8} y={LINE.y - 4} w={LINE.w + 16} h={LINE.h + 8} />
      </Camera>
      <Toast t={t} from={0.2} to={2.6} corner="top-right" tone="applied" title={`${CAB_APRIL.title} added`} description="1 line on Phoenix release runbook changed." />
    </StageProviders>
  );
}

export const rewrite: Scene = { duration: 4, Component: Rewrite, title: "A newer file rewrites one line" };
