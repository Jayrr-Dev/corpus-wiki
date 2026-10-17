"use client";

import { InfoPopover } from "@/components/standard/info-popover";
import type { SkillLibrary } from "@/lib/ai/skills/types";
import { AI_FLOW } from "./aiFlowCanvas";
import { FlowCanvas, type CanvasTab } from "./FlowCanvas";

export function AiFlowTab({ library, onNavigate }: { library: SkillLibrary; onNavigate: (tab: CanvasTab) => void }) {
  return <section aria-label="AI flow" className="space-y-3">
    <div className="flex items-center gap-2">
      <h2 className="text-xl font-semibold tracking-tight">How your AI roles work together</h2>
      <InfoPopover label="About the AI flow">
        <p>Read it left to right. Every change drops into Change control, which applies the safe ones and holds the rest for you. Select a shape for details.</p>
        <p>Drag or scroll to move around. Ctrl and scroll, or pinch, to zoom. This map shows how the workflow is built, not a live run.</p>
      </InfoPopover>
    </div>
    <FlowCanvas diagram={AI_FLOW} label="AI flow canvas" library={library} onNavigate={onNavigate} />
  </section>;
}
