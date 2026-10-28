"use client";

import {
  PopoverWizard,
  type PopoverWizardStep,
} from "@/components/standard/popover-wizard";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

// SECTION GUIDE: the info icon opens a wizard, one step per control
export function SectionGuide({
  label,
  steps,
}: {
  label: string;
  steps: readonly PopoverWizardStep[];
}) {
  if (steps.length === 0) return null;
  return (
    <PopoverWizard
      steps={steps}
      side="right"
      align="start"
      width="sm"
      jumpFromDots
      trigger={
        <button
          type="button"
          aria-label={label}
          className="shrink-0 rounded text-faint hover:text-text data-[state=open]:text-text"
        >
          <InfoIcon className="size-3.5" aria-hidden="true" />
        </button>
      }
    />
  );
}

// PANEL SECTION: a collapsible block with a small chevron, like Obsidian's Filters / Groups / Display / Forces.
// `steps` puts a wizard behind an info icon on the right of the title.
export function PanelSection({ title, steps, defaultOpen = false, children }: { title: string; steps?: readonly PopoverWizardStep[]; defaultOpen?: boolean; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col gap-2 border-b py-2 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex flex-1 items-center gap-1.5 text-left text-panel font-medium text-muted-foreground hover:text-text"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cn("transition-transform", isOpen && "rotate-90")}>
            <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
        </button>
        {steps ? <SectionGuide label={`About ${title}`} steps={steps} /> : null}
      </div>
      {isOpen ? <div className="flex flex-col gap-3 pl-4">{children}</div> : null}
    </section>
  );
}
