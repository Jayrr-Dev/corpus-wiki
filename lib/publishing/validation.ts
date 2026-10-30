import { z } from "zod";

export const publicationSlug = z.string().regex(/^[a-f0-9]{32}$/);
export const publicationInput = z.object({
  visibility: z.enum(["private", "unlisted", "public"]),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  publisher: z.string().trim().max(80),
  embedEnabled: z.boolean(),
  includeSources: z.boolean().default(false),
  thumbnailChosen: z.boolean().default(false),
  pages: z.array(z.object({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/) })).max(100),
}).refine(v => v.visibility === "private" || v.pages.length > 0, { message: "Choose at least one page to publish." })
  .refine(v => new Set(v.pages.map(p => p.id)).size === v.pages.length, { message: "Choose each page once." });

export function exploreOffset(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? Math.min(10000, Math.max(0, parsed)) : 0;
}

export const metricInput = z.object({
  ticket: z.string().max(2500),
  visitor: z.uuid(),
  kind: z.enum(["view", "engaged"]),
});
