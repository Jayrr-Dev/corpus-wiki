import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// CLASS MERGE: joins class names and lets later Tailwind classes win (shadcn's `cn`)
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
