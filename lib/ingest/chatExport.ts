import type { ExtractedPage } from "./passages";
import { isZip, zipEntries } from "./zipEntry";

// =====================================================================
// CHATGPT EXPORT: reads a ChatGPT data export (its conversations.json,
// or the export .zip holding it) into conversations, each a title, the
// time it was started and the messages people saw, labelled by speaker.
// Behind the chat_import flag (see chatImport.ts for the sources it makes).
// =====================================================================

export type ChatMessage = { speaker: string; text: string };
export type ChatConversation = { id: string | null; title: string; createdAt: string | null; messages: ChatMessage[] };

// WHO SAID IT: only the person and the assistant; system, tool and hidden messages are left out
export const CHAT_SPEAKERS: Readonly<Record<string, string>> = { user: "User", assistant: "ChatGPT" };
export const UNTITLED_CHAT = "Untitled chat";
const EXPORT_FILE = "conversations.json";

export const NOT_A_CHAT_EXPORT = "This isn't a ChatGPT export. Upload the conversations.json from your ChatGPT data export, or the export .zip.";

// THE EXPORT IN A FILE: the zip's conversations.json, or the JSON file itself
export function readChatExport(bytes: Uint8Array): ChatConversation[] {
  return parseChatExport(parseJson(exportJsonBytes(bytes)));
}

// CONTENT DETECTION: true when the bytes hold a ChatGPT export, whatever the file is called
export function isChatExport(bytes: Uint8Array): boolean {
  try {
    return looksLikeChatExport(parseJson(exportJsonBytes(bytes)));
  } catch {
    return false;
  }
}

// The conversations.json bytes: the file itself, or the one inside the zip (at its top, else the shallowest)
function exportJsonBytes(bytes: Uint8Array): Uint8Array {
  if (!isZip(bytes)) return bytes;
  const matches = zipEntries(bytes)
    .filter((entry) => entry.name.split("/").pop()?.toLowerCase() === EXPORT_FILE)
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  const entry = matches[0];
  if (!entry) throw new Error(`No ${EXPORT_FILE} was found in this zip. ${NOT_A_CHAT_EXPORT}`);
  return entry.read();
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
  } catch {
    throw new Error(NOT_A_CHAT_EXPORT);
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const isConversation = (value: unknown): value is Json => isObject(value) && isObject(value.mapping);

// The shape of an export: a list of conversations, each with a `mapping` of message nodes
export function looksLikeChatExport(json: unknown): boolean {
  return Array.isArray(json) && (json.length === 0 || json.some(isConversation));
}

// EVERY CONVERSATION WITH SOMETHING SAID IN IT, in the export's order
export function parseChatExport(json: unknown): ChatConversation[] {
  if (!looksLikeChatExport(json)) throw new Error(NOT_A_CHAT_EXPORT);
  return (json as unknown[]).filter(isConversation).map(readConversation).filter((conversation) => conversation.messages.length > 0);
}

function readConversation(raw: Json): ChatConversation {
  const nodes = raw.mapping as Record<string, unknown>;
  const messages = threadOf(nodes, typeof raw.current_node === "string" ? raw.current_node : null).flatMap((node) => {
    const message = readMessage(node.message);
    return message ? [message] : [];
  });
  const id = typeof raw.conversation_id === "string" ? raw.conversation_id : typeof raw.id === "string" ? raw.id : null;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : UNTITLED_CHAT;
  return { id, title, createdAt: isoTime(raw.create_time) ?? firstMessageTime(nodes), messages };
}

// THE THREAD SHOWN: from the conversation's current message back to its start, so an edited
// question's abandoned branch is left out. Without a current message, every message by time.
function threadOf(nodes: Record<string, unknown>, current: string | null): Json[] {
  if (current && isObject(nodes[current])) {
    const thread: Json[] = [];
    const seen = new Set<string>();
    for (let id: unknown = current; typeof id === "string" && !seen.has(id) && isObject(nodes[id]); id = (nodes[id] as Json).parent) {
      seen.add(id);
      thread.push(nodes[id] as Json);
    }
    return thread.reverse();
  }
  return Object.values(nodes).filter(isObject).sort((a, b) => messageTime(a) - messageTime(b));
}

function messageTime(node: Json): number {
  const time = isObject(node.message) ? node.message.create_time : null;
  return typeof time === "number" ? time : Number.POSITIVE_INFINITY;
}

// One message the person saw, or null (system prompts, tool calls and results, hidden context, empty text)
function readMessage(raw: unknown): ChatMessage | null {
  if (!isObject(raw) || !isObject(raw.author)) return null;
  const speaker = typeof raw.author.role === "string" ? CHAT_SPEAKERS[raw.author.role] : undefined;
  if (!speaker) return null;
  if (isObject(raw.metadata) && raw.metadata.is_visually_hidden_from_conversation === true) return null;
  // A message addressed to a tool (a search, code to run) is not part of the conversation
  if (typeof raw.recipient === "string" && raw.recipient !== "all") return null;
  const text = cleanText(contentText(raw.content));
  return text ? { speaker, text } : null;
}

// The text of a message's content: its string parts (images and files are left out)
function contentText(content: unknown): string {
  if (!isObject(content)) return "";
  if (content.content_type === "text" || content.content_type === "multimodal_text") {
    return Array.isArray(content.parts) ? content.parts.filter((part): part is string => typeof part === "string").join("\n\n") : "";
  }
  if (content.content_type === "code" && typeof content.text === "string") return content.text;
  return "";
}

// ChatGPT marks citations with private-use characters; they mean nothing outside its app
function cleanText(text: string): string {
  return text.replace(/[-]/g, "").trim();
}

// A Unix time in seconds (ChatGPT's, with a fraction) as an ISO timestamp
function isoTime(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(Math.round(value * 1000)).toISOString();
}

function firstMessageTime(nodes: Record<string, unknown>): string | null {
  const times = Object.values(nodes).filter(isObject).map(messageTime).filter(Number.isFinite);
  return times.length ? isoTime(Math.min(...times)) : null;
}

// THE CONVERSATION AS PASSAGE INPUT: one page per message, labelled by speaker (passages.ts)
export function conversationPages(conversation: ChatConversation): ExtractedPage[] {
  return conversation.messages.map(({ speaker, text }) => ({ page: null, text, speaker }));
}

// THE CONVERSATION AS THE STORED FILE: a Markdown transcript, the copy a source keeps
export function conversationMarkdown(conversation: ChatConversation): string {
  const started = conversation.createdAt ? `\n\nStarted: ${conversation.createdAt}` : "";
  const messages = conversation.messages.map(({ speaker, text }) => `## ${speaker}\n\n${text}`).join("\n\n");
  return `# ${conversation.title}\n\nChatGPT conversation${started}\n\n${messages}\n`;
}
