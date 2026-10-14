import type { Enums } from "@/lib/database/types";

// =====================================================================
// INGESTION (agent C): CONTRACT STUB, implemented next.
// =====================================================================

export type StartUploadResult =
  | { kind: "skipped"; sourceId: string }
  | { kind: "started"; sourceId: string; eventId: string };

export type ProcessUploadResult = {
  status: Enums<"event_status">;
  changeSetId: string | null;
  error: string | null;
};

// Stores the PDF, extracts its passages and opens the upload event (C implements)
export async function startUploadFromFile(input: { file: File; sourceDate: string }): Promise<StartUploadResult> {
  void input;
  throw new Error("startUploadFromFile is not built yet.");
}

// Runs reconciliation, the commit and the page rebuild for an upload event (C implements)
export async function processUploadEvent(eventId: string): Promise<ProcessUploadResult> {
  void eventId;
  throw new Error("processUploadEvent is not built yet.");
}
