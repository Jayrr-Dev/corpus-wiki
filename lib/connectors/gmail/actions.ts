"use server";

import { after } from "next/server";
import { currentAgentSession } from "@/lib/agents/session";
import { requireUser } from "@/lib/auth/requireUser";
import { requireFeature } from "@/lib/flags/server";
import { processUploadEvent, startEmailThreadSource, startUploadFromAttachment } from "@/lib/ingest";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";
import type { GmailLabel } from "./api";
import { serverGmailService } from "./server";
import type { GmailStatus, ImportResult } from "./service";

// =====================================================================
// GMAIL IMPORT ACTIONS (Settings > Gmail). Each is a 404 while the
// gmail_import flag is off, needs a signed-in person, and refuses agents.
// None returns a token: only the account address, labels and counts.
// =====================================================================

async function gate(): Promise<string> {
  await requireFeature("gmail_import");
  const user = await requireUser();
  if (currentAgentSession()) throw new Error("Agents cannot manage the Gmail connection.");
  return user.id;
}

export async function getGmailStatus(): Promise<ActionResult<{ status: GmailStatus }>> {
  return toActionResult(async () => ({ status: await serverGmailService().status(await gate()) }));
}

export async function listGmailLabels(): Promise<ActionResult<{ labels: GmailLabel[] }>> {
  return toActionResult(async () => ({ labels: await serverGmailService().labels(await gate()) }));
}

export async function saveGmailLabels(labelIds: string[]): Promise<ActionResult<{ labelIds: string[] }>> {
  return toActionResult(async () => ({ labelIds: await serverGmailService().setLabels(await gate(), labelIds) }));
}

// IMPORT NOW: step 1 for every new thread here; step 2 runs on each one after the response
export async function importGmailNow(): Promise<ActionResult<{ result: ImportResult }>> {
  return toActionResult(async () => {
    const personId = await gate();
    const { eventIds, ...result } = await serverGmailService().importNow(personId, { startThread: startEmailThreadSource, startAttachment: startUploadFromAttachment });
    if (eventIds.length) after(() => processInOrder(eventIds));
    return { result };
  });
}

// DISCONNECT: deletes the stored tokens (and asks Google to end the grant)
export async function disconnectGmail(): Promise<ActionResult<{ revoked: boolean }>> {
  return toActionResult(async () => serverGmailService().disconnect(await gate()));
}

// One event at a time, so a large import never runs many model calls at once;
// one that fails stays on Recent uploads with Resume (and the recovery worker retries it)
async function processInOrder(eventIds: string[]): Promise<void> {
  for (const eventId of eventIds) {
    try {
      await processUploadEvent(eventId, "articles");
    } catch (error) {
      console.error("Gmail import processing failed:", error);
    }
  }
}
