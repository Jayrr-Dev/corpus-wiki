"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setAutoUpdateStale } from "@/lib/server-actions/settings";

// STALE LINES: rewrite them when an article opens, or leave them for Update
export function AutoUpdateStale({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerAction(setAutoUpdateStale);

  const apply = async (next: boolean) => {
    const result = await save.run(next);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-4 text-panel font-medium">
        Automatically refresh stale lines
        <Switch checked={enabled} disabled={save.isPending} onCheckedChange={(next) => void apply(next)} />
      </label>
      <p className="text-panel text-muted-foreground">Rewrite stale lines while you are signed in, even if that article is not open. Turn this off to update each section manually.</p>
      <ErrorNote error={save.error} />
    </div>
  );
}
