import "server-only";
import { type AiCallLogger, logSafely } from "@/lib/ai/callLog";
import { fetchWithRetry, withRequestSlot } from "@/lib/processing/requests";
import { cleanOcrMarkdown, requireReadableFile, type TextReader } from "./ocr";

// THE TEXT READER the app uses: Mistral OCR (https://docs.mistral.ai/api/endpoint/ocr), logged
// like every AI call. The model is AI_OCR_MODEL, else mistral-ocr-latest. Null without
// MISTRAL_API_KEY (scanned PDFs then give no text, and images keep only their description).
export const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";
const REQUEST_TIMEOUT_MS = 180_000;

type OcrResponse = { pages?: { index: number; markdown?: string }[]; model?: string; usage_info?: { pages_processed?: number }; message?: string; detail?: unknown };

export function textReaderFrom(env: NodeJS.ProcessEnv = process.env, logCall?: AiCallLogger): TextReader | null {
  if (!env.MISTRAL_API_KEY) return null;
  const apiKey = env.MISTRAL_API_KEY;
  const model = env.AI_OCR_MODEL || DEFAULT_OCR_MODEL;
  return async (file) => {
    requireReadableFile(file);
    const started = Date.now();
    let error: string | null = null;
    let pagesRead: number | null = null;
    const dataUrl = `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString("base64")}`;
    const document = file.mimeType.startsWith("image/") ? { type: "image_url", image_url: dataUrl } : { type: "document_url", document_url: dataUrl };
    try {
      const body = await withRequestSlot("chat", new URL(MISTRAL_OCR_URL).host, apiKey, async (signal) => {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = await fetchWithRetry(MISTRAL_OCR_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, document, ...(file.pages ? { pages: [...file.pages] } : {}), include_image_base64: false }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const body = (await response.json().catch(() => ({}))) as OcrResponse;
        if (!response.ok || !Array.isArray(body.pages)) throw new Error(body.message ?? `OCR request failed (${response.status})`);
        return body;
      });
      pagesRead = body.usage_info?.pages_processed ?? body.pages!.length;
      const pages = [...body.pages!].sort((a, b) => a.index - b.index);
      if (file.pages && pages.length !== file.pages.length) throw new Error(`${model} read ${pages.length} pages; ${file.pages.length} were asked for`);
      return pages.map((page) => cleanOcrMarkdown(page.markdown ?? ""));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      throw caught;
    } finally {
      await logSafely(logCall, {
        role: "media_analyst",
        purpose: "ocr",
        subject: pagesRead === null ? file.fileName : `${file.fileName} (${pagesRead} page${pagesRead === 1 ? "" : "s"})`,
        model,
        reasoningEffort: "none",
        promptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        durationMs: Date.now() - started,
        status: error ? "error" : "ok",
        error,
      });
    }
  };
}
