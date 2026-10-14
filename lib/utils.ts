import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// CLASS MERGER: knows our font-size tokens (app/globals.css --text-panel/body/title),
// otherwise tailwind-merge reads "text-panel" as a color and drops it next to "text-faint"
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["panel", "body", "title"] }] } },
});

// CLASS MERGE: joins class names and lets later Tailwind classes win (shadcn's `cn`)
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
