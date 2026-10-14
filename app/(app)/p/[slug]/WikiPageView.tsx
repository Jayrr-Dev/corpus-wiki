"use client";

import { useState } from "react";
import { PageIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { LiveSection, type SelectedSentence, SentencePanel } from "@/components/living-page";
import { ReadingPane, RightPanelSlot } from "@/components/shell";
import type { Tables } from "@/lib/database/types";
import { usePages, useSections } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";

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

// PAGE BODY: sections in order, redrawn live; a clicked sentence fills the right panel
function WikiPageBody({ page }: { page: Tables<"pages"> }) {
  const [selected, setSelected] = useState<SelectedSentence | null>(null);
  const { data: sections = [], isPending } = useSections({ filters: { page_id: page.id } });
  useRealtimeInvalidation("sections", { filter: `page_id=eq.${page.id}` });
  useRealtimeInvalidation("change_notes");
  return (
    <ReadingPane title={page.title} width="prose">
      {isPending ? <p className="text-panel text-faint">Loading…</p> : null}
      {!isPending && sections.length === 0 ? <EmptyState icon={PageIcon} title="This page has no sections yet" /> : null}
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <LiveSection key={section.id} section={section} selected={selected} onSelect={setSelected} />
        ))}
      </div>
      {selected ? (
        <RightPanelSlot>
          <SentencePanel key={`${selected.sectionId}-${selected.start}`} unitIds={selected.unitIds} />
        </RightPanelSlot>
      ) : null}
    </ReadingPane>
  );
}
