import { z } from "zod";
import type { Message } from "@/lib/chatbot/types";

export type SavedChat = { id: string; title: string; updatedAt: number; messages: Message[] };
const reference = z.object({ id: z.string(), title: z.string(), href: z.string().regex(/^\/(?:units|p|sources)\/[^\s]+$/), kind: z.enum(["Knowledge", "Article", "Source"]), text: z.string() });
const historySchema = z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.number(), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string(), references: z.array(reference).optional() })) }));
export function readHistory(raw: string | null): SavedChat[] {
  if (!raw) return [];
  return historySchema.parse(JSON.parse(raw));
}
export function saveConversation(chats: SavedChat[], id: string, messages: Message[], now = Date.now()): SavedChat[] {
  if (!messages.length) return chats;
  return [{ id, title: messages.find(m => m.role === "user")?.content.slice(0, 100) || "New chat", updatedAt: now, messages }, ...chats.filter(chat => chat.id !== id)];
}
