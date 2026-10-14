"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// LABEL: form label in the muted text color
function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-panel font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  );
}

export { Label };
