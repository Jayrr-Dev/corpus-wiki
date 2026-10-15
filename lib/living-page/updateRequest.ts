import { z } from "zod";

export const articleUpdateSchema = z.object({
  scope: z.enum(["page", "section", "tree"]),
  id: z.uuid(),
  note: z.string().trim().max(2000).default(""),
});
export type ArticleUpdateRequest = z.input<typeof articleUpdateSchema>;
