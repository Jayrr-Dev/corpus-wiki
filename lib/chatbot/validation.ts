import { z } from "zod";

export const chatRequest = z.object({
  entityId: z.string().uuid().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) })).min(1).max(20),
}).refine(({ messages }) => messages.at(-1)?.role === "user", "A question must be the last message.");

export function searchFilter(columns: string[], question: string): string {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter(word => !["the", "and", "what", "how", "does", "are", "can", "you", "about", "that", "with", "this", "from", "have"].includes(word)).slice(-8);
  return words.flatMap(word => columns.map(column => `${column}.ilike.%${word}%`)).join(",");
}
