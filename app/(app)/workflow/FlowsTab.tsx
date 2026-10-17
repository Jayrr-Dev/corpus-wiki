"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { GraphIcon } from "@/components/icons";
import { InfoPopover } from "@/components/standard/info-popover";
import type { SkillLibrary } from "@/lib/ai/skills/types";
import { KNOWLEDGE_FLOW, RESEARCH_FLOW } from "./flowModel";
import { KNOWLEDGE_CANVAS, RESEARCH_CANVAS } from "./flowsCanvas";
import { FlowCanvas, type CanvasTab } from "./FlowCanvas";
import styles from "./flowCanvas.module.css";

export function FlowsTab({ library, onNavigate }: { library: SkillLibrary; onNavigate: (tab: CanvasTab) => void }) {
  const [view, setView] = useState<"knowledge" | "research">("knowledge");
  const flow = view === "knowledge" ? KNOWLEDGE_FLOW : RESEARCH_FLOW;

  return <section aria-label="Workflow diagrams" className="space-y-3">
    <div className={styles.intro}>
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{flow.title}</h2>
        <InfoPopover label="About this flow">
          <p>{flow.description} Read it left to right and select a step for its roles and current skills.</p>
          <p>Drag or scroll to move around. Ctrl and scroll, or pinch, to zoom. Skill names reflect your current assignments; this is not a live run monitor.</p>
        </InfoPopover>
      </div>
      <div className={styles.viewSwitch} aria-label="Choose a flow">
        <button type="button" aria-pressed={view === "knowledge"} onClick={() => setView("knowledge")}><GraphIcon size={15} /> Knowledge pipeline</button>
        <button type="button" aria-pressed={view === "research"} onClick={() => setView("research")}><Search size={15} /> Outside research</button>
      </div>
    </div>
    {/* A new view starts fresh: its own zoom, position and selection */}
    <FlowCanvas key={view} diagram={view === "knowledge" ? KNOWLEDGE_CANVAS : RESEARCH_CANVAS} label={`${view === "knowledge" ? "Knowledge pipeline" : "Outside research"} canvas`} library={library} onNavigate={onNavigate} />  </section>;
}
