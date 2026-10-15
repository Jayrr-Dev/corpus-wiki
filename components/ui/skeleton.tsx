// SKELETON: jayrr.dev registry item "skeleton" (https://jayrr.dev/r/skeleton.json).
// Local changes: `cn` from "@/lib/utils" (one class merger).

import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
