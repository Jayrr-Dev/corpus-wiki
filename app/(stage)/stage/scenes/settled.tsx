"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { Camera, Cursor, Highlight, hoverAmount, StageProviders, StageShell, Toast, type Scene } from "@/components/video-stage";
import { articleEvidence, CAB_APRIL, DEPLOY_WINDOW_KEY, lineId, RUNBOOK_SETTLED, shownLines } from "@/lib/video-stage/phoenix/article";
import { lineCss, WikiArticle } from "./wiki";

// =====================================================================
// SETTLED: "A normal wiki only knows what someone remembered to write
// down. This one keeps up on its own." The runbook after the conflict
// was approved: the deploy-window line holds the new window, cited to
// April's CAB minutes; a toast confirms (0.3 to 2.5); the cursor rests
// on the line; the view drifts slowly.
// =====================================================================

const DEPLOY = lineId(RUNBOOK_SETTLED, DEPLOY_WINDOW_KEY);
// frame pixels, measured on the stage: the deploy-window paragraph and its "Updated …" button
const LINE = { x: 773, y: 306, w: 800, h: 56 };
const REST = { x: 962, y: 352 };

function Settled({ t }: { t: number }) {
  const lines = shownLines(RUNBOOK_SETTLED);
  const evidence = articleEvidence(RUNBOOK_SETTLED, lines);
  return (
    <StageProviders>
      <style>{lineCss(DEPLOY, hoverAmount(t, 0.9, 9))}</style>
      <Camera t={t} keys={[[0, 1.12, 1060, 300], [5.8, 1.18, 1220, 330]]}>
        <StageShell>
          <WikiArticle article={RUNBOOK_SETTLED} lines={lines} evidence={evidence} selectedLineId={null} />
        </StageShell>
        <Highlight t={t} from={0.5} to={4.2} x={LINE.x - 8} y={LINE.y - 4} w={LINE.w + 16} h={LINE.h + 8} />
        <Cursor t={t} path={[[0, REST.x + 140, REST.y + 120], [0.9, REST.x, REST.y], [5.8, REST.x + 10, REST.y + 6]]} />
      </Camera>
      <Toast t={t} from={0.3} to={2.5} corner="top-right" tone="applied" title="Change approved" description={`Deploy window now cites ${CAB_APRIL.title}.`} />
    </StageProviders>
  );
}

export const settled: Scene = { duration: 5.8, Component: Settled, title: "The page keeps up" };
