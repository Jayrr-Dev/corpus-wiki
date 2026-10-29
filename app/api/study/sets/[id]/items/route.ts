import { z } from "zod";
import { addQuestionByHand, newQuestionSchema } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../../guard";

// ADD BY HAND (admin mode): one question on a claim already in the set
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const parsed = newQuestionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Fill in the claim, the question and the answer.");
  try {
    await addQuestionByHand(guard.db, guard.userId, id.data, parsed.data);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
