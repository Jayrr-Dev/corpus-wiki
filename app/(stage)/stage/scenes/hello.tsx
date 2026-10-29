"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { Button } from "@/components/ui/button";
import { Camera, Cursor, interaction, StageProviders, StageShell, Toast, type Scene } from "@/components/video-stage";
import { PEOPLE, SOURCES } from "@/lib/video-stage/phoenix/core";

// HELLO: the sample scene. The cursor glides to a real app button, hovers, clicks it
// (press and ripple), a toast confirms, and the camera pushes in slowly. About 4 seconds.

const CLICK = 2;
// The button's centre in frame pixels (measured on the stage at 1920x1080)
const BUTTON = { x: 1344, y: 48 };

function Hello({ t }: { t: number }) {
  const published = t >= CLICK + 0.05;
  return (
    <StageProviders>
      <Camera t={t} keys={[[0.2, 1, 1100, BUTTON.y], [3.8, 1.15, 1100, BUTTON.y]]}>
        <StageShell
          title="Phoenix release runbook"
          width="prose"
          actions={
            <span style={{ display: "inline-block", ...interaction(t, { hover: [1.35, 2.6], click: CLICK }) }}>
              <Button>{published ? "Published" : "Publish page"}</Button>
            </span>
          }
        >
          <p className="text-muted-foreground">
            Rebuilt from {SOURCES.runbook.title} and {SOURCES.handover.title}. {PEOPLE.brent.name} owned this until his last day.
          </p>
        </StageShell>
        <Cursor t={t} path={[[0, 1240, 640], [0.3, 1240, 640], [1.4, BUTTON.x, BUTTON.y]]} clicks={[CLICK]} />
      </Camera>
      {/* outside the camera: the toast stays pinned to the screen corner while the view pushes in */}
      <Toast t={t} from={CLICK + 0.3} to={4} tone="applied" title="Page published" description="The team sees it in Pages now." />
    </StageProviders>
  );
}

export const hello: Scene = { duration: 4, Component: Hello, title: "Hello" };
