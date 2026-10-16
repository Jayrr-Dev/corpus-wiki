import { requireUser } from "@/lib/auth/requireUser";
import { exceptionDecision } from "@/lib/chatbot/agentTools";
import { answerException } from "@/lib/server-actions/knowledge";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Please sign in again." }, { status: 401 }); }
  const decision = exceptionDecision.safeParse(await request.json().catch(() => null));
  if (!decision.success) return Response.json({ error: "Invalid exception decision." }, { status: 400 });
  const { exceptionId, accept, note } = decision.data;
  const result = await answerException(exceptionId, accept, note);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
