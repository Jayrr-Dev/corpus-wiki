import { apiKeyMatches, bearerToken } from "@/lib/auth/apiKey";
import { requireUser } from "@/lib/auth/requireUser";
import { captureFile } from "@/lib/ingest";

// =====================================================================
// ONE-CALL CAPTURE: POST anything worth remembering and the whole
// pipeline runs in this request (store -> passages -> Nemotron ->
// Change control -> living pages). The answer says what changed.
//
//   JSON       { "text": "...", "title"?: "...", "sourceDate"?: "YYYY-MM-DD" }
//   multipart  file=<pdf|docx|md|txt>, sourceDate?=YYYY-MM-DD
//   text/*     the raw note as the body; ?title=...&sourceDate=...
//
// Auth: `Authorization: Bearer $SECOND_BRAIN_API_KEY`, or a signed-in session.
// sourceDate defaults to today (UTC).
// =====================================================================

// Reconciliation and page rewrites call the model; give them time
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const denied = await checkCaller(request);
  if (denied) return denied;
  let input: { file: File; sourceDate: string };
  try {
    input = await readCapture(request);
  } catch (error) {
    return fail(400, error);
  }
  try {
    return Response.json({ ok: true, ...(await captureFile(input)) });
  } catch (error) {
    return fail(422, error);
  }
}

// A valid API key, or else a signed-in browser session; null means allowed
async function checkCaller(request: Request): Promise<Response | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (token) return apiKeyMatches(token, process.env.SECOND_BRAIN_API_KEY) ? null : fail(401, "Invalid API key.");
  try {
    await requireUser();
    return null;
  } catch {
    return fail(401, "Send Authorization: Bearer <SECOND_BRAIN_API_KEY> or sign in.");
  }
}

// THE BODY AS A FILE: an uploaded file as is, a text note as a Markdown file
async function readCapture(request: Request): Promise<{ file: File; sourceDate: string }> {
  const url = new URL(request.url);
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Send the file in a form field named `file`.");
    return { file, sourceDate: dateOrToday(form.get("sourceDate")) };
  }
  if (type.startsWith("application/json")) {
    const body = (await request.json()) as { text?: unknown; title?: unknown; sourceDate?: unknown };
    return { file: noteFile(body.text, body.title), sourceDate: dateOrToday(body.sourceDate) };
  }
  const text = await request.text();
  return { file: noteFile(text, url.searchParams.get("title")), sourceDate: dateOrToday(url.searchParams.get("sourceDate")) };
}

// A text note becomes a Markdown file named after its title (or the date)
function noteFile(text: unknown, title: unknown): File {
  if (typeof text !== "string" || !text.trim()) throw new Error("Send some text (`text` in JSON, or the raw body).");
  const name = typeof title === "string" && title.trim() ? title.trim() : `Note ${today()}`;
  const fileName = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
  return new File([text], fileName, { type: "text/markdown" });
}

function dateOrToday(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : today();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(status: number, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ ok: false, error: message }, { status });
}
