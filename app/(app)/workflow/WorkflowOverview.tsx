"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { InfoHint } from "@/components/standard/info-hint";
import { useRef, useState } from "react";
import { OTHER_PHASES, UPLOAD_PHASES, WORKFLOW_SAFEGUARDS, type OverviewPhase } from "./workflowOverviewModel";

const CONTROLS = { skills: "Skill instructions", roles: "Role instructions", builtin: "Built-in AI policy", system: "App rules" };

const PHASE_SUMMARIES: Record<string, string> = {
  knowledge: "Save your source, extract the key facts, and organize them by topic.",
  articles: "Turn those facts into articles, with citations and a review for accuracy.",
  enrichment: "Describe subjects, build profiles, write the glossary, and tidy the page tree.",
  research: "Find and review outside sources to fill gaps in your knowledge.",
  "on-request": "Start a review, refresh profiles, or tidy up your topics when needed.",
  illustrations: "Choose, review and save useful images without turning illustrations into evidence.",
  assets: "Track image uses, restore deleted media, unlink placements and clean up unused files.",
  graph: "Organize knowledge and domains, with Undo and Redo for graph changes.",
  sourcer: "Request outside information, save its sources, and create cited knowledge without another permission prompt.",
};

export function WorkflowOverview({ onAssignments }: { onAssignments: () => void }) {
  const [selectedId, setSelectedId] = useState(UPLOAD_PHASES[0]!.steps[0]!.id);
  const panelRef = useRef<HTMLElement>(null);
  const phases = [...UPLOAD_PHASES, ...OTHER_PHASES];
  const selectedPhase = phases.find((phase) => phase.steps.some((step) => step.id === selectedId))!;
  const selectedStep = selectedPhase.steps.find((step) => step.id === selectedId)!;
  function selectStep(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      panelRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      panelRef.current?.focus({ preventScroll: true });
    }
  }

  return <section aria-label="Workflow overview" className="space-y-6">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">How your workspace works</h2>
          <InfoHint>Covers upload processing, illustrations, asset cleanup, graph edits and research. Additional workflows run on their own triggers.</InfoHint>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Select a step for its details.</p>
      </div>
      <Link href="/upload" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Upload progress <ArrowRight aria-hidden="true" className="size-3" /></Link>
    </div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-8">
        <div className="grid gap-5 xl:grid-cols-3">
          {UPLOAD_PHASES.map((phase, index) => <Phase key={phase.id} phase={phase} number={index + 1} selectedId={selectedId} onSelect={selectStep} />)}
        </div>
        <section aria-label="Additional workflows" className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">Additional workflows</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            {OTHER_PHASES.map((phase) => <Phase key={phase.id} phase={phase} selectedId={selectedId} onSelect={selectStep} />)}
          </div>
        </section>
      </div>
      <aside ref={panelRef} id="workflow-step-details" tabIndex={-1} aria-label="Step details" className="scroll-mt-20 rounded-md border bg-muted/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:sticky lg:top-4">
        <button type="button" className="mb-4 text-xs underline underline-offset-4 lg:hidden" onClick={() => {
          const stepButton = document.getElementById(`workflow-step-${selectedId}`);
          stepButton?.scrollIntoView({ block: "center", behavior: "instant" });
          stepButton?.focus({ preventScroll: true });
        }}>Back to steps</button>
        <p className="mb-3 text-xs text-muted-foreground">Step details · {selectedPhase.name}</p>
        <div aria-live="polite" aria-atomic="true">
          <h3 className="text-sm font-semibold">{selectedStep.name}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedStep.description}</p>
          <p className="mt-3 text-sm leading-6">{selectedStep.detail}</p>
          <dl className="mt-5 space-y-4 border-t pt-4 text-xs leading-5">
            <div><dt className="font-medium">When it runs</dt><dd className="mt-1 text-muted-foreground">{selectedStep.trigger ?? selectedPhase.trigger}</dd></div>
            <div><dt className="font-medium">Instructions</dt><dd className="mt-1 text-muted-foreground">{CONTROLS[selectedStep.control]} · {selectedStep.control === "builtin" || selectedStep.control === "system" ? "managed by the app" : "editable"}</dd></div>
          </dl>
        </div>
        {selectedStep.control === "skills" ? <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={onAssignments}>Skill assignments</Button><Link href="/roles" className="text-xs underline underline-offset-4">Agent Roles overrides</Link></div>
          : selectedStep.control === "roles" ? <Link href="/roles" className="mt-4 inline-block text-xs underline underline-offset-4">Open Agent Roles</Link> : null}
      </aside>
    </div>
    <section aria-label="Approvals and settings" className="space-y-4 border-t pt-5">
      <h3 className="text-sm font-semibold">Controls</h3>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {WORKFLOW_SAFEGUARDS.map((item) => <div key={item.id}>
          <Link href={item.href} className="text-panel font-medium underline-offset-4 hover:underline">{item.name} <ArrowRight aria-hidden="true" className="inline size-3" /></Link>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
        </div>)}
      </div>
    </section>
  </section>;
}

function Phase({ phase, number, selectedId, onSelect }: { phase: OverviewPhase; number?: number; selectedId: string; onSelect: (id: string) => void }) {
  return <section aria-labelledby={`phase-${phase.id}`} className="min-w-0">
    <div className={number ? "border-b pb-3 xl:min-h-24" : "border-b pb-3"}>
      <h3 id={`phase-${phase.id}`} className="text-sm font-semibold">
        {number ? <span className="mr-2 font-mono text-xs text-muted-foreground">{number}.</span> : null}
        {phase.id === "enrichment" ? "Background updates" : phase.name}
      </h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{PHASE_SUMMARIES[phase.id]}</p>
    </div>
    <ol className="mt-2 space-y-1">
      {phase.steps.map((step) => <li key={step.id}>
        <button id={`workflow-step-${step.id}`} type="button" aria-pressed={selectedId === step.id} aria-controls="workflow-step-details" onClick={() => onSelect(step.id)} className={`w-full rounded-sm border-l-2 px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selectedId === step.id ? "border-foreground bg-muted" : "border-transparent hover:bg-muted/50"}`}>
          <span className="block text-xs font-medium leading-5">{step.name}</span>
        </button>
      </li>)}
    </ol>
  </section>;
}
