"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { StakeholderCard } from "@/app/(app)/stakeholders/StakeholderCard";
import { ReadingPane } from "@/components/shell";
import { Camera, Cursor, easeOut, hoverAmount, interaction, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { articleEvidence, BRENT_CARD, HANDOVER, personCard, shownLines } from "@/lib/video-stage/phoenix/article";
import { WikiArticle } from "./wiki";

// =====================================================================
// BRENT: "Brent's knowledge? Still here." Brent Geller's stakeholder
// card (lead engineer, left 3 Apr 2026, 31 claims from 4 sources); the
// cursor clicks "Brent's handover" (1.2) and his handover page opens
// full of cited lines (from 1.5).
// =====================================================================

const CLICK = 1.2;
const OPEN = 1.5;
// frame pixels, measured on the stage: the "Brent's handover" link and Brent's card
const LINK = { x: 596, y: 497 };
const CARD = { x: 620, y: 300 };

const CARDS = [
  BRENT_CARD,
  personCard("wes", 18, 5, "Took over the deploy scripts from Brent."),
  personCard("patty", 22, 6, "Chairs the change advisory board."),
];

function Brent({ t }: { t: number }) {
  const opened = t >= OPEN;
  const lines = shownLines(HANDOVER);
  const enter = easeOut(seg(t, OPEN, OPEN + 0.3));
  return (
    <StageProviders>
      <Camera t={t} keys={opened ? [[OPEN, 1, 1100, 120], [3, 1.05, 1100, 120]] : [[0, 1, CARD.x, CARD.y], [OPEN, 1.08, CARD.x, CARD.y]]}>
        <StageShell>
          {opened ? (
            <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 14}px)` }}>
              <WikiArticle article={HANDOVER} lines={lines} evidence={articleEvidence(HANDOVER, lines)} />
            </div>
          ) : (
            <ReadingPane title="Stakeholders" width="wide">
              <ul className="grid grid-cols-3 gap-4">
                {CARDS.map((card) => <li key={card.entityId}><StakeholderCard card={card} /></li>)}
              </ul>
              {/* the same box a wiki page lists its subpages in */}
              <section aria-label="Pages about Brent Geller" className="w-[calc((100%-2rem)/3)] rounded-md border p-4">
                <h2 className="mb-2 font-semibold">Pages about Brent Geller</h2>
                <ul className="grid gap-2">
                  <li>
                    <span style={{ display: "inline-block", ...interaction(t, { hover: [0.95, 9], click: CLICK }) }}>
                      <a href="#" className="text-link" style={{ textDecoration: hoverAmount(t, 0.95, 9) > 0.5 ? "underline" : undefined }}>{HANDOVER.title}</a>
                    </span>
                  </li>
                  <li><a href="#" className="text-link hover:underline">Phoenix release runbook</a></li>
                </ul>
              </section>
            </ReadingPane>
          )}
        </StageShell>
        <Cursor t={t} path={[[0, 1100, 760], [0.15, 1100, 760], [0.95, LINK.x, LINK.y], [OPEN, LINK.x, LINK.y], [3, LINK.x + 520, LINK.y + 90]]} clicks={[CLICK]} />
      </Camera>
    </StageProviders>
  );
}

export const brent: Scene = { duration: 3, Component: Brent, title: "Brent's knowledge, still here" };
