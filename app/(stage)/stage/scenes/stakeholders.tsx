"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { StakeholdersScreen } from "@/app/(app)/stakeholders/StakeholdersScreen";
import { Camera, Cursor, easeOut, Highlight, hoverAmount, lerp, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { queryKeys } from "@/lib/queries";
import { STAKEHOLDER_CARDS } from "@/lib/video-stage/phoenix/connect";

// STAKEHOLDERS: the real Stakeholders screen; the people cards land one after another,
// the cursor settles on Brent's card, and a highlight rings it on "AUTOMATICALLY". 2.4 seconds.

const DURATION = 2.4;
// When the first card starts, the gap between cards, and how long one takes to land
const FIRST = -0.15;
const GAP = 0.17;
const LAND = 0.4;
// Brent's card in frame pixels (measured on the stage at 1920x1080)
const BRENT = { x: 532, y: 325, w: 358, h: 360 };
const HIGHLIGHT_FROM = 1.2;
// The camera pushes in around the middle of Brent's card
const FOCUS = { x: BRENT.x + BRENT.w / 2, y: BRENT.y + BRENT.h / 2 };

// The people section's grid (the company card sits in its own section below the fold)
const PEOPLE_LIST = '[data-stage-frame] section[aria-label="People"] ul';
const PEOPLE_CARDS = STAKEHOLDER_CARDS.filter((card) => card.type === "person");

const CARDS_KEY = [...queryKeys.table("entity_profiles"), "cards"];
const STRUCTURE_KEY = [...queryKeys.table("entity_profiles"), "structure"];
const MISSING_KEY = [...queryKeys.table("entity_profiles"), "missing"];

// One rule per card: drop in from above and settle; Brent's border lights on hover
function landStyles(t: number): string {
  const rules = PEOPLE_CARDS.map((_, index) => {
    const p = easeOut(seg(t, FIRST + index * GAP, FIRST + index * GAP + LAND));
    return `${PEOPLE_LIST} > li:nth-child(${index + 1}) { opacity: ${p.toFixed(3)}; transform: translateY(${lerp(-26, 0, p).toFixed(1)}px) scale(${lerp(0.94, 1, p).toFixed(4)}); }`;
  });
  const hover = hoverAmount(t, 1.0, DURATION + 1);
  rules.push(`${PEOPLE_LIST} > li:nth-child(1) article { border-color: color-mix(in oklab, var(--sb-link) ${Math.round(hover * 55)}%, var(--sb-border)); }`);
  return rules.join("\n");
}

function Stakeholders({ t }: { t: number }) {
  return (
    <StageProviders
      seed={(qc) => {
        qc.setQueryData(CARDS_KEY, STAKEHOLDER_CARDS);
        qc.setQueryData(STRUCTURE_KEY, []);
        qc.setQueryData(MISSING_KEY, 0);
      }}
    >
      <style>{landStyles(t)}</style>
      <Camera t={t} keys={[[0, 1.02, FOCUS.x, FOCUS.y], [0.9, 1.04, FOCUS.x, FOCUS.y], [DURATION, 1.12, FOCUS.x, FOCUS.y]]}>
        <StageShell title="Stakeholders">
          <StakeholdersScreen />
        </StageShell>
        <Highlight t={t} from={HIGHLIGHT_FROM} to={DURATION + 1} {...BRENT} />
        <Cursor t={t} path={[[0, 1380, 760], [0.3, 1340, 720], [1.05, BRENT.x + 200, BRENT.y + 50]]} />
      </Camera>
    </StageProviders>
  );
}

export const stakeholders: Scene = { duration: DURATION, Component: Stakeholders, title: "Stakeholders" };
