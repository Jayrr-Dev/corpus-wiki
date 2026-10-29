import { createStudySet, newSetSchema, studyDeps } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../guard";

export const maxDuration = 300;

// NEW SET: builds a study set and streams the question count as the Tutor writes
// ({type:"progress", done, total} lines, then {type:"result", id, items} or {type:"error", error})
export async function POST(request: Request) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const parsed = newSetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Pick a source and at least one question type.");
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        const result = await createStudySet(studyDeps(guard.db), guard.userId, parsed.data, (done, total) => send({ type: "progress", done, total }));
        send({ type: "result", ...result });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : String(error) });
      } finally { if (!disconnected) controller.close(); }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
