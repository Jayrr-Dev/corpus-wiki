import { type CostedCall, estimateCallCost, estimateCost } from "@/lib/ai/pricing";
import { creditsForCost } from "./plans";

// =====================================================================
// CREDITS PER CALL: what one AI call costs in credits, from the same price
// table the usage page uses (lib/ai/pricing.ts). Before a call only its
// size is known, so the gate reserves an estimate and settles afterwards.
// =====================================================================

// Every reservation takes at least this much, so an unpriced model is never free
export const MIN_RESERVATION_CREDITS = 1;

// About four characters to a token, for the prompt we are about to send
const CHARS_PER_TOKEN = 4;

// Credits one finished call cost (null: the model is unpriced or the provider sent no usage)
export function creditsForCall(call: CostedCall): number | null {
  return creditsForCost(estimateCallCost(call));
}

export type CallEstimate = { model: string; promptChars: number; maxTokens: number };

// Credits to reserve before a call: its prompt plus the whole output budget, rounded up
export function estimateCallCredits(call: CallEstimate): number {
  const promptTokens = Math.ceil(Math.max(0, call.promptChars) / CHARS_PER_TOKEN);
  const credits = creditsForCost(estimateCost(call.model, promptTokens, Math.max(0, call.maxTokens)));
  return Math.max(MIN_RESERVATION_CREDITS, Math.ceil(credits ?? 0));
}

// Characters in a chat request's messages (text parts only; a picture counts as a few hundred)
export function promptCharacters(messages: readonly { content: unknown }[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === "string") total += message.content.length;
    else if (Array.isArray(message.content)) {
      for (const part of message.content as { type?: string; text?: unknown }[]) {
        total += part?.type === "text" && typeof part.text === "string" ? part.text.length : 1_000;
      }
    }
  }
  return total;
}
