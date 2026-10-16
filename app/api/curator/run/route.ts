import { requireUser } from "@/lib/auth/requireUser";
import { runCurator } from "@/lib/curator/runCurator";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        const result = await runCurator(detail => send({ type: "progress", detail }));
        send({ type: "result", result });
      } finally { if (!disconnected) controller.close(); }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
