"use client";

import { useEffect, useState } from "react";
import { SECTION_BUILD_EVENT, type SectionBuildMessage, sectionBuildChannel, type SectionDraft } from "@/lib/living-page/buildProgress";
import { getBrowserSupabase } from "@/lib/supabase/client";

// =====================================================================
// SECTION BUILD FEED: while a section is not current, listens on its
// Broadcast channel for the step the server is on, the model's visible
// thinking and the paragraphs written so far. Cleared when the build
// ends; the committed lines then arrive through the table feed.
// =====================================================================

export type SectionBuild = { step: string | null; thinking: string | null; draft: SectionDraft | null };

const EMPTY: SectionBuild = { step: null, thinking: null, draft: null };

export function useSectionBuild(sectionId: string, enabled: boolean): SectionBuild {
  const [build, setBuild] = useState<SectionBuild>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    const supabase = getBrowserSupabase();
    let lastSeq = 0;
    const channel = supabase
      .channel(sectionBuildChannel(sectionId))
      .on("broadcast", { event: SECTION_BUILD_EVENT }, ({ payload }) => {
        const message = payload as SectionBuildMessage;
        // A restarted build numbers from 1 again; anything else older than what is shown is late
        if (message.seq <= lastSeq && message.seq !== 1) return;
        lastSeq = message.seq;
        setBuild((current) => {
          if (message.kind === "done") return EMPTY;
          if (message.kind === "step") return message.seq === 1 ? { ...EMPTY, step: message.text } : { ...current, step: message.text };
          if (message.kind === "thinking") return { ...current, thinking: message.text };
          return { ...current, thinking: null, draft: message.draft };
        });
      })
      .subscribe();
    return () => {
      setBuild(EMPTY);
      void supabase.removeChannel(channel);
    };
  }, [sectionId, enabled]);

  return enabled ? build : EMPTY;
}
