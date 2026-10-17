import { apiKeyMatches, bearerToken } from "@/lib/auth/apiKey";
import { processOneComposerJob } from "@/lib/composer/worker";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const key = process.env.PROCESSING_WORKER_KEY;
  if (!key || process.env.COMPOSER_AUTO_ENABLED === "false") return Response.json({ error: "Composer scheduler is not configured or is disabled." }, { status: 503 });
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !apiKeyMatches(token,key)) return Response.json({ error: "Invalid worker key." }, { status: 401 });
  return Response.json({ worked: await processOneComposerJob() });
}
