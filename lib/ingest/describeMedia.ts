import { z } from "zod";
import type { ChatMediaMessage, ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// IMAGE DESCRIPTIONS: an image is a source like a PDF, but it has no text
// to extract, so a vision model writes it. The description is the image's
// text: it is split into passages, the reconciler turns those into claims
// citing the image, and the article shows the image beside the lines that
// cite them. The summary comes first, so passage 0 is the figure caption.
// =====================================================================

// PROMPT VERSION: recorded in the AI call log under the call name
export const DESCRIBE_IMAGE_PROMPT_VERSION = "describe-image-v2";

// VISION MODEL: AI_VISION_MODEL, else this Token Factory default. The model picked on
// /settings is a text model, so images always go to a model that can see.
export const DEFAULT_VISION_MODEL = "nvidia/Nemotron-3.5-Super-VL";
export function resolveVisionModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
}

// LARGEST IMAGE SENT (it travels inline as base64, a third bigger again)
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// WHAT A CONVERTER NEEDS TO HAVE AN IMAGE DESCRIBED (the server wires the model in)
export type ImageToDescribe = { bytes: Uint8Array; mimeType: string; fileName: string };
export type ImageDescriber = (image: ImageToDescribe) => Promise<string>;

const answerSchema = z.object({ summary: z.string(), details: z.array(z.string()) });
export const describeImageAnswerSchema = answerSchema;
export type DescribeImageAnswer = z.infer<typeof answerSchema>;
export const describeImageAnswerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You describe one image for a personal knowledge base. Your description is the only text the knowledge base will have for this image: facts are extracted from it and cited back to the image.

Answer with JSON only: { "summary": "...", "details": ["...", "..."] }.
- summary: one or two sentences saying what the image is and what it is about, written as a figure caption ("Floor plan of the second-floor office, with twelve desks and two meeting rooms.").
- details: short paragraphs, each able to stand alone (name the subject again; no "it" or "this" pointing back). Cover what a reader needs to know: what is shown, every number, label, legend and date, and transcribe any readable text exactly.
- Write details as facts about the subject, not about the drawing: "The second-floor office has twelve desks.", not "The plan shows twelve rectangles." Group related facts in one paragraph.
- State only what is visible. The examples here are not about this image; never take facts from them. Never guess identities, places or dates that the image does not show in writing. No opinions about style or quality.
- Use the file name only as a hint for what the image is about.
- Plain text only: no Markdown, no bullet characters, no headings.`;

// The prompt: the instructions, then the file's name and the picture itself
export function buildDescribeImageMessages(image: ImageToDescribe): (ChatMessage | ChatMediaMessage)[] {
  const dataUrl = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [{ type: "text", text: `File name: ${image.fileName}` }, { type: "image_url", image_url: { url: dataUrl } }] },
  ];
}

// ANSWER -> the image's text: the summary first, then one paragraph per detail. Whitespace is
// flattened and a leading "#" or bullet removed, so no paragraph is read as a heading or list.
export function describeImageAnswerToText(answer: DescribeImageAnswer): string {
  const paragraphs = [answer.summary, ...answer.details]
    .map((paragraph) => paragraph.replace(/\s+/g, " ").replace(/^(?:#+|[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  return [...new Set(paragraphs)].join("\n\n");
}

// Refuses an image too big to send, before any model is called
export function requireDescribableImage(image: ImageToDescribe): void {
  if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`This image is ${Math.ceil(image.bytes.byteLength / 1024 / 1024)} MB; images up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB can be described. Save a smaller copy and upload that.`);
  }
}
