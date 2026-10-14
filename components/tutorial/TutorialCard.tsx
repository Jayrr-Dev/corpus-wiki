"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TUTORIAL_STEPS } from "./steps";
import { useTutorialDismissed } from "./useTutorialDismissed";

// =====================================================================
// FLOATING TUTORIAL: a small card in the bottom-right corner that walks
// through the first run one step at a time. Closing it is remembered;
// a "Tutorial" button in the same corner brings it back.
// =====================================================================

export function TutorialCard() {
  const [isDismissed, setIsDismissed] = useTutorialDismissed();
  const [stepIndex, setStepIndex] = useState(0);

  // Reopens at the first step
  const reopen = () => {
    setStepIndex(0);
    setIsDismissed(false);
  };

  if (isDismissed) {
    return (
      <Button type="button" size="sm" variant="outline" className="fixed right-4 bottom-4 z-40" onClick={reopen}>
        Tutorial
      </Button>
    );
  }
  return <TutorialPanel stepIndex={stepIndex} onStep={setStepIndex} onClose={() => setIsDismissed(true)} />;
}

type TutorialPanelProps = { stepIndex: number; onStep: (index: number) => void; onClose: () => void };

// THE OPEN CARD: step count, title, text, a link to where the step happens, Back / Next
function TutorialPanel({ stepIndex, onStep, onClose }: TutorialPanelProps) {
  const step = TUTORIAL_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;
  if (!step) return null;
  return (
    <aside aria-label="Tutorial" className="fixed right-4 bottom-4 z-40 flex w-72 flex-col gap-2 rounded-md border bg-background p-3 shadow-lg">
      <div className="flex items-center justify-between text-panel text-faint">
        <span>
          Step {stepIndex + 1} of {TUTORIAL_STEPS.length}
        </span>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close tutorial">
          ×
        </Button>
      </div>
      <h2 className="text-body font-semibold">{step.title}</h2>
      <p className="text-panel text-muted-foreground">{step.body}</p>
      <Link href={step.href} className="text-panel text-link hover:underline">
        {step.linkLabel}
      </Link>
      <div className="flex justify-end gap-2">
        {isFirst ? null : (
          <Button type="button" size="sm" variant="ghost" onClick={() => onStep(stepIndex - 1)}>
            Back
          </Button>
        )}
        <Button type="button" size="sm" onClick={isLast ? onClose : () => onStep(stepIndex + 1)}>
          {isLast ? "Done" : "Next"}
        </Button>
      </div>
    </aside>
  );
}
