"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setAutoUpdateStale } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor="auto-update-stale" className="text-panel font-medium">Automatically refresh stale lines</label>
          <SettingHint>Rewrite stale lines while you are signed in, even if that article is not open. Turn this off to update each section manually.</SettingHint>
        </div>
        <Switch id="auto-update-stale" checked={enabled} disabled={save.isPending} onCheckedChange={(next) => void apply(next)} />
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}
