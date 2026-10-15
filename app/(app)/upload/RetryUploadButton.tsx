"use client";

import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { retryUpload } from "@/lib/server-actions/upload";

// RETRY (Recent uploads): runs a failed upload again with the model chosen in Settings now.
// The table refreshes when it finishes; a new failure shows in the row's Error column.
export function RetryUploadButton({ eventId }: { eventId: string }) {
  const retry = useServerAction(retryUpload, { progress: { title: "Retrying upload", detail: "Reading the file with AI…" } });
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => void retry.run(eventId)}>
        {retry.isPending ? "Retrying…" : "Retry"}
      </Button>
      <div className="max-w-48 whitespace-normal break-words"><ErrorNote error={retry.error} /></div>
    </div>
  );
}
