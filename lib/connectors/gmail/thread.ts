import type { GmailMessage, GmailMessagePart, GmailThread } from "./api";

// =====================================================================
// ONE GMAIL THREAD AS A SOURCE: its subject, the date its first message
// was sent, and each message's sender, date and text (quoted replies cut,
// so a message never repeats the one before it). Attachments are listed
// for the import to fetch.
// =====================================================================

export type EmailMessage = { id: string; sender: string; senderName: string; sentAt: string; text: string };
export type EmailAttachment = { messageId: string; attachmentId: string | null; inlineData: string | null; fileName: string; mimeType: string; sentAt: string };
export type EmailThread = { id: string; subject: string; sentAt: string; messages: EmailMessage[]; attachments: EmailAttachment[] };

// One message's text is capped so a huge newsletter cannot swamp the pipeline
export const MAX_MESSAGE_CHARS = 20_000;

export function parseThread(thread: GmailThread): EmailThread {
  const messages = [...(thread.messages ?? [])].sort((a, b) => sentTime(a) - sentTime(b));
  const parsed = messages.map(parseMessage);
  const subject = messages.map((message) => header(message.payload, "subject")?.trim()).find(Boolean) ?? "(no subject)";
  return {
    id: thread.id,
    subject,
    sentAt: parsed[0]?.sentAt ?? new Date(0).toISOString(),
    messages: parsed.filter((message) => message.text),
    attachments: messages.flatMap((message) => attachmentsOf(message)),
  };
}

function parseMessage(message: GmailMessage): EmailMessage {
  const from = header(message.payload, "from") ?? "Unknown sender";
  return {
    id: message.id,
    sender: from.trim(),
    senderName: senderName(from),
    sentAt: new Date(sentTime(message)).toISOString(),
    text: clip(stripQuoted(bodyText(message.payload))),
  };
}

// The Date header, else Gmail's own receive time
function sentTime(message: GmailMessage): number {
  const fromHeader = Date.parse(header(message.payload, "date") ?? "");
  if (Number.isFinite(fromHeader)) return fromHeader;
  const internal = Number(message.internalDate);
  return Number.isFinite(internal) ? internal : 0;
}

function header(part: GmailMessagePart | undefined, name: string): string | undefined {
  return part?.headers?.find((item) => item.name.toLowerCase() === name)?.value;
}

// "Jane Doe" <jane@example.com> -> Jane Doe; a bare address stays as it is
export function senderName(from: string): string {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return from.trim();
  return match[1]?.trim() || match[2]!.trim();
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

// Parts of the body (not attachments) of one MIME type, depth first
function bodyParts(part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart[] {
  if (!part) return [];
  if (part.filename) return [];
  if (part.mimeType === mimeType && part.body?.data) return [part];
  return (part.parts ?? []).flatMap((child) => bodyParts(child, mimeType));
}

// Plain text when the message has it, else its HTML as text
export function bodyText(payload: GmailMessagePart | undefined): string {
  const plain = bodyParts(payload, "text/plain").map((part) => decode(part.body?.data)).join("\n\n");
  if (plain.trim()) return normalize(plain);
  const html = bodyParts(payload, "text/html").map((part) => decode(part.body?.data)).join("\n\n");
  return normalize(htmlToText(html));
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Cuts the quoted earlier message ("On Mon, Jane wrote:" and the "> " lines after it)
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*>/.test(line)) continue;
    const next = lines.slice(index + 1).find((candidate) => candidate.trim());
    if (/^On .+wrote:\s*$/.test(line.trim()) && (!next || /^\s*>/.test(next))) continue;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    kept.push(line);
  }
  return normalize(kept.join("\n"));
}

function clip(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS).trimEnd()}…` : text;
}

function attachmentsOf(message: GmailMessage): EmailAttachment[] {
  const sentAt = new Date(sentTime(message)).toISOString();
  const found: EmailAttachment[] = [];
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      found.push({ messageId: message.id, attachmentId: part.body.attachmentId ?? null, inlineData: part.body.attachmentId ? null : (part.body.data ?? null), fileName: part.filename, mimeType: part.mimeType ?? "", sentAt });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  return found;
}

// The thread as Markdown: the stored copy of the source
export function threadMarkdown(thread: EmailThread): string {
  const body = thread.messages.map((message) => `## ${message.sender} · ${message.sentAt}\n\n${message.text}`).join("\n\n");
  return `# ${thread.subject}\n\n${body}\n`;
}
