import { z } from "zod";
import { answerItem, answerSchema, studyDeps } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../guard";

export const maxDuration = 60;

// The browser's time zone decides what "a later day" means for moving up a level
const bodySchema = answerSchema.extend({ timeZone: z.string().max(64).optional() });

// ANSWER: records one answer (the Tutor grades short answers) and returns the claim's new level
export async function POST(request: Request) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("That answer could not be read.");
  const { timeZone, ...input } = parsed.data;
  try {
    return Response.json(await answerItem(studyDeps(guard.db), guard.userId, input, timeZone));
  } catch (error) { return errorResponse(error); }
}
