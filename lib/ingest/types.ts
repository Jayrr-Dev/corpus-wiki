import type { Enums } from "@/lib/database/types";

// RESULT OF UPLOAD STEP 1: the file is new (an event was opened) or was uploaded before
export type StartUploadResult =
  | { kind: "skipped"; sourceId: string }
  | { kind: "started"; sourceId: string; eventId: string };

// RESULT OF UPLOAD STEP 2: the event's final status and the ChangeSet it produced
export type ProcessUploadResult = {
  status: Enums<"event_status">;
  changeSetId: string | null;
  error: string | null;
};
