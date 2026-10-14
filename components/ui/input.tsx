import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// INPUT: one-line text field with the border token
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-panel text-foreground placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
