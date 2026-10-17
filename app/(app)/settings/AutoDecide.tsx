"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setGlossaryAutoDecide } from "@/lib/server-actions/settings";

export function AutoDecide({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerAction(setGlossaryAutoDecide);
  return <div className="flex flex-col gap-2">
    <div className="flex items-start justify-between gap-6">
      <div className="space-y-1">
        <label htmlFor="glossary-auto-decide" className="text-panel font-medium">Auto Decide</label>
        <p id="glossary-auto-decide-help" className="text-panel text-muted-foreground">Let AI keep, combine, or discard glossary duplicates. Includes those waiting now.</p>
        <p className="text-xs text-muted-foreground">You can undo its choices in Changes.</p>
      </div>
      <Switch id="glossary-auto-decide" aria-describedby="glossary-auto-decide-help" checked={enabled} disabled={save.isPending}
        onCheckedChange={async (next) => { const result = await save.run(next); if (result.ok) router.refresh(); }} />
    </div>
    <ErrorNote error={save.error} />
  </div>;
}
