import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@/components/icons";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon: ComponentType<IconProps>;
  title: string;
  hint?: ReactNode;
  // A next step, such as a button to where the list gets filled
  action?: ReactNode;
  className?: string;
};

// EMPTY STATE: one line and an icon when a list or page has nothing to show
export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-12 text-center text-muted-foreground", className)}>
      <Icon className="text-faint" />
      <p className="text-panel">{title}</p>
      {hint ? <p className="text-panel text-faint">{hint}</p> : null}
      {action}
    </div>
  );
}
