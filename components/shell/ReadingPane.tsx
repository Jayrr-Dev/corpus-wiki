import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ModuleHelp } from "@/components/tutorial/ModuleHelp";

type ReadingPaneProps = {
  title: string;
  // `prose` = the narrow wiki column; `wide` = table pages; `full` = wide tables that should use the whole pane
  width?: "prose" | "wide" | "full";
  actions?: ReactNode;
  children?: ReactNode;
};

// READING PANE: the page title (20px) above the page body, at reading or table width
export function ReadingPane({ title, width = "wide", actions, children }: ReadingPaneProps) {
  return (
    <div className={cn("mx-auto flex flex-col gap-4 px-6 py-6", { prose: "max-w-2xl", wide: "max-w-6xl", full: "w-full" }[width])}>
      <header data-tour="module-header" className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><h1 className="text-title font-semibold">{title}</h1><ModuleHelp /></div>
        {actions}
      </header>
      <div data-tour="reading-pane" className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}
