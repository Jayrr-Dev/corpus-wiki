"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { RightPanelSlot } from "@/components/shell";
import { LinePanel, LiveSection } from "@/components/living-page";
import { ArticleSources } from "@/components/living-page/ArticleSources";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import { Camera, Cursor, easeOut, Highlight, hoverAmount, lerp, seg, StageProviders, StageShell, typed, type Scene } from "@/components/video-stage";
import type { ArticleEvidence } from "@/lib/living-page/articleEvidence";
import type { ShownLine } from "@/lib/queries/sectionLines";
import { articleEvidence, DEPLOY_WINDOW_KEY, lineId, RUNBOOK, sectionRows, seedLinePanel, shownLine, type Article } from "@/lib/video-stage/phoenix/article";

// =====================================================================
// PAGE (scene id "page"; the file is not page.tsx, which Next would make a route):
// "It pulls out the facts, and writes the wiki for you. Every line…
// linked to where it came from." The runbook writes itself line by line
// (0 to 3.0), the cursor clicks the deploy-window line (3.3) and its
// evidence panel slides in with the claim and source, the citation
// highlighted. Slow push-in. Also exports the wiki page view the
// rewrite, settled and brent scenes draw with.
// =====================================================================

const noop = () => {};

// THE WIKI PAGE: WikiPageView's layout (header, contents, sections, references) from the real
// living-page components. `lines` may hold a subset (a page still being written).
export function WikiArticle({ article, lines, evidence, selectedLineId = null, sectionOpacity }: {
  article: Article;
  lines: ShownLine[];
  evidence: ArticleEvidence;
  selectedLineId?: string | null;
  // 0..1 per section key; a section at 0 is not drawn yet
  sectionOpacity?: (key: string) => number;
}) {
  const sections = sectionRows(article);
  const shown = sections.filter((_, index) => (sectionOpacity?.(article.sections[index]!.key) ?? 1) > 0);
  const overview = shown.find((section) => section.title === "Overview");
  const topics = shown.filter((section) => section !== overview);
  const keyOf = (id: string) => article.sections.find((section) => sections.find((row) => row.id === id && row.title === section.title))?.key ?? "";
  const renderSection = (section: (typeof sections)[number], hideHeading = false) => {
    const sectionLines = lines.filter((line) => line.sectionId === section.id);
    return (
      <div key={section.id} style={{ opacity: sectionOpacity?.(keyOf(section.id)) ?? 1 }}>
        {/* keyed by the text so a retyped line mounts fresh instead of running PatchedText's timed fade */}
        <LiveSection key={sectionLines.map((line) => `${line.lineRevisionId}:${line.content.length}`).join("|")} section={section} lines={sectionLines} selectedLineId={selectedLineId} onSelect={noop} onSelectSection={noop} evidence={evidence} hideHeading={hideHeading} />
      </div>
    );
  };
  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <header className="mb-6 border-b pb-4">
        <nav aria-label="Page hierarchy" className="mb-3 flex flex-wrap items-center gap-2 text-panel">
          <a href="#" className="text-link hover:underline">Knowledge</a>
          <span aria-hidden="true">/</span><span aria-current="page">{article.title}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 font-serif text-3xl leading-tight">{article.title}</h1>
          <div className="text-panel">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline">Review page</Button>
              <Button type="button" size="sm" variant="outline">Update</Button>
              <RowMenu label={article.title} items={[{ label: "Add section", run: noop }]} />
            </div>
          </div>
        </div>
      </header>
      <div className="grid min-w-0 gap-8 xl:grid-cols-[10rem_minmax(0,1fr)]">
        <nav aria-label="Article contents" className="text-panel xl:sticky xl:top-6 xl:self-start">
          <h2 className="mb-2 font-semibold">Contents</h2>
          <ol className="space-y-2 border-l pl-3">
            {overview ? <li><a className="text-link hover:underline" href={`#section-${overview.id}`}>Introduction</a></li> : null}
            {topics.map((section, index) => <li key={section.id}><a className="text-link hover:underline" href={`#section-${section.id}`}>{index + 1}. {section.title}</a></li>)}
            <li><a className="text-link hover:underline" href="#article-sources">References</a></li>
          </ol>
        </nav>
        <article className="min-w-0 space-y-8" aria-label={article.title}>
          {overview ? renderSection(overview, true) : null}
          {topics.map((section) => renderSection(section))}
          <ArticleSources references={evidence.references} loading={false} />
        </article>
      </div>
    </div>
  );
}

// STAGE CSS for one line: its hidden "Updated …" button shown as if hovered, and an optional extra rule
export function lineCss(id: string, hover: number, extra = ""): string {
  return `#line-${id} button[aria-label^="View evidence"] { opacity: ${hover} !important; ${hover > 0.5 ? "color: var(--color-link);" : ""} } ${extra}`;
}

// A line still being written: no citations or "[source needed]" yet, and a typing caret after its words
export const typingCss = (id: string) => `#line-${id} > sup, #line-${id} > span.text-faint { display: none; } #line-${id} > span:first-child::after { content: ""; display: inline-block; width: 2px; height: 19px; margin-left: 3px; vertical-align: -4px; background: rgb(255 255 255 / 0.85); }`;

// The right panel's width (the app slides it from 0 to 18rem), driven from t
export const panelCss = (open: number) => `aside[aria-label="Details"] { width: ${lerp(0, 288, easeOut(open))}px !important; border-left-width: ${open > 0 ? 1 : 0}px !important; }`;

// WRITING ORDER: when each line starts typing (its section fades in with it); each types in TYPE seconds
const STARTS: Record<string, number> = { overview: 0.15, "deploy-window": 0.65, freeze: 1.05, rollback: 1.5, declines: 1.9, owners: 2.3, "manual-steps": 2.65 };
const TYPE = 0.38;

const CLICK = 3.3;
const DEPLOY = lineId(RUNBOOK, DEPLOY_WINDOW_KEY);
// frame pixels, measured on the stage: the deploy line's "Updated …" button before the panel opens,
// and the citation chip in the open panel
const DETAILS = { x: 936, y: 350 };
const CHIP = { x: 1650, y: 307, w: 238, h: 93 };

function Page({ t }: { t: number }) {
  const lines: ShownLine[] = [];
  const cited = new Set<string>();
  RUNBOOK.lines.forEach((line, index) => {
    const start = STARTS[line.key]!;
    if (t < start) return;
    const p = seg(t, start, start + TYPE);
    lines.push(shownLine(RUNBOOK, line, index, typed(line.text, p)));
    if (p >= 1) cited.add(lineId(RUNBOOK, line.key));
  });
  const evidence = articleEvidence(RUNBOOK, lines, cited);
  const typing = lines.filter((line) => !cited.has(line.lineId)).map((line) => typingCss(line.lineId)).join(" ");
  const sectionOpacity = (key: string) => {
    const first = Math.min(...RUNBOOK.lines.filter((line) => line.section === key).map((line) => STARTS[line.key]!));
    return seg(t, first, first + 0.2);
  };
  const selected = t >= CLICK;
  const deployLine = RUNBOOK.lines.find((line) => line.key === DEPLOY_WINDOW_KEY)!;
  return (
    <StageProviders seed={(qc) => seedLinePanel(qc, RUNBOOK, deployLine)}>
      <style>{lineCss(DEPLOY, hoverAmount(t, 2.95, 9)) + panelCss(seg(t, CLICK + 0.05, CLICK + 0.5)) + typing}</style>
      <Camera t={t} keys={[[0, 1, 1100, 80], [3.0, 1.03, 1300, 80], [6, 1.08, 1700, 80]]}>
        <StageShell>
          <WikiArticle article={RUNBOOK} lines={lines} evidence={evidence} selectedLineId={selected ? DEPLOY : null} sectionOpacity={sectionOpacity} />
          {selected ? (
            <RightPanelSlot onClose={noop}>
              <LinePanel line={shownLine(RUNBOOK, deployLine, 1)} preview={null} onPreview={noop} isEditing={false} onEdit={noop} />
            </RightPanelSlot>
          ) : null}
        </StageShell>
        <Highlight t={t} from={3.9} to={6.2} {...CHIP} />
        <Cursor t={t} path={[[0, 1990, 640], [2.15, 1990, 640], [3.15, DETAILS.x, DETAILS.y], [CLICK + 0.35, DETAILS.x, DETAILS.y], [5.0, 1480, 470]]} clicks={[CLICK]} />
      </Camera>
    </StageProviders>
  );
}

export const page: Scene = { duration: 6, Component: Page, title: "Wiki page writes itself" };
