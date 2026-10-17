import { apiKeyMatches, bearerToken } from "@/lib/auth/apiKey";
import { runScheduledRecovery } from "@/lib/processing/recovery";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request): Promise<Response> {
  const key = process.env.PROCESSING_WORKER_KEY;
  if (!key) return Response.json({ error: "Recovery scheduler is not configured." }, { status: 503 });
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !apiKeyMatches(token, key)) return Response.json({ error: "Invalid worker key." }, { status: 401 });
  return Response.json({ worked: await runScheduledRecovery() });
}
