import type { Enums } from "@/lib/database/types";

// RESULT OF UPLOAD STEP 1: the file is new (an event was opened) or was uploaded before
export type StartUploadResult =
  | { kind: "skipped"; sourceId: string }
  | { kind: "started"; sourceId: string; eventId: string };

// RESULT OF UPLOAD STEP 2: the event's final status and the ChangeSet it produced
export type ProcessUploadResult = {
  workflow?: import("./workflowTypes").UploadWorkflow;
  status: Enums<"event_status">;
  changeSetId: string | null;
  error: string | null;
};

// RESULT OF THE ONE-CALL CAPTURE: skipped (seen before) or both steps run
export type CaptureResult =
  | { kind: "skipped"; sourceId: string }
  | ({ kind: "processed"; sourceId: string; eventId: string } & ProcessUploadResult);
