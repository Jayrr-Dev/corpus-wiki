"use client";

import { useState } from "react";
import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { LinePanel, LiveSection } from "@/components/living-page";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import type { Tables } from "@/lib/database/types";
import { type ShownLine, usePages, useSectionLines, useSections } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { AddSectionDialog } from "./AddSectionDialog";
import { SectionMenu } from "./SectionMenu";

// WIKI PAGE VIEW: finds the page by slug, then shows its live sections
export function WikiPageView({ slug }: { slug: string }) {
  const { data: pages = [], isPending, error } = usePages({ filters: { slug } });
  const page = pages[0];
  if (isPending) return <ReadingPane title="Loading…" width="prose" />;
  if (error || !page) {
    return (
      <ReadingPane title="Page" width="prose">
        <EmptyState icon={PageIcon} title={error ? error.message : "No page with this address"} hint={<span className="font-mono">{slug}</span>} />
      </ReadingPane>
    );
  }
  return <WikiPageBody page={page} />;
}

// PAGE BODY: sections in order with their lines, redrawn live; a clicked line fills the right panel
function WikiPageBody({ page }: { page: Tables<"pages"> }) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const { data: sections = [], isPending } = useSections({ filters: { page_id: page.id } });
  const { data: lines = [] } = useSectionLines(page.id);
  useRealtimeInvalidation("sections", { filter: `page_id=eq.${page.id}` });
  useRealtimeInvalidation("lines");
  useRealtimeInvalidation("change_notes");
  // The selected line follows its latest text (a rewrite keeps the line id)
  const selected = lines.find((line) => line.lineId === selectedLineId);
  return (
    <ReadingPane title={page.title} width="prose" actions={<PageActions page={page} />}>
      {isPending ? <p className="text-panel text-faint">Loading…</p> : null}
      {!isPending && sections.length === 0 ? <EmptyState icon={PageIcon} title="This page has no sections yet" /> : null}
      <div className="flex flex-col gap-6" data-tour="page-body">
        {sections.map((section) => (
          <LiveSection
            key={section.id}
            section={section}
            lines={linesOf(lines, section.id)}
            selectedLineId={selectedLineId}
            onSelect={(line) => setSelectedLineId(line.lineId)}
            menu={<SectionMenu section={section} />}
          />
        ))}
      </div>
      {selected ? (
        <RightPanelSlot>
          <LinePanel key={selected.lineRevisionId} line={selected} />
        </RightPanelSlot>
      ) : null}
    </ReadingPane>
  );
}

// PAGE HEADER ACTIONS: add a section, and the page's own menu (rename, remove)
function PageActions({ page }: { page: Tables<"pages"> }) {
  return (
    <div className="flex items-center gap-1">
      <AddSectionDialog page={page} />
      <PageMenu page={page} />
    </div>
  );
}

// One section's lines, in position order (the view is ordered by position already)
function linesOf(lines: ShownLine[], sectionId: string): ShownLine[] {
  return lines.filter((line) => line.sectionId === sectionId);
}
