import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ReadingPaneProps = {
  title: string;
  // `prose` = the narrow wiki column; `wide` = table pages
  width?: "prose" | "wide";
  actions?: ReactNode;
  children?: ReactNode;
};

// READING PANE: the page title (20px) above the page body, at reading or table width
export function ReadingPane({ title, width = "wide", actions, children }: ReadingPaneProps) {
  return (
    <div className={cn("mx-auto flex flex-col gap-4 px-6 py-6", width === "prose" ? "max-w-2xl" : "max-w-6xl")}>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-title font-semibold">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  );
}
