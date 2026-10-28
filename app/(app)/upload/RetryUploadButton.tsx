"use client";
import { useState } from "react";

import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { retryUpload } from "@/lib/server-actions/upload";

// Resume unfinished stages with the current model settings; completed stages stay saved.
export function RetryUploadButton({ eventId }: { eventId: string }) {
  const retry = useServerAction(retryUpload, { progress: false });
  const [stageError, setStageError] = useState<string | null>(null);
  const resume = async () => {
    setStageError(null);
    const result = await retry.run(eventId);
    if (result.ok) setStageError(result.error);
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Tooltip content="Finishes the stages left undone, with the current model. Finished stages stay saved.">
        <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => void resume()}>
          {retry.isPending ? "Resuming…" : "Resume"}
        </Button>
      </Tooltip>
      <div className="max-w-48 whitespace-normal break-words"><ErrorNote error={retry.error ?? stageError} /></div>
    </div>
  );
}
