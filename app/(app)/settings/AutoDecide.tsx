"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setGlossaryAutoDecide } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

export function AutoDecide({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerAction(setGlossaryAutoDecide);
  return <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5">
        <label htmlFor="glossary-auto-decide" className="text-panel font-medium">Glossary Auto Decide</label>
        <SettingHint>AI keeps, combines or discards glossary duplicates, including those waiting now. You can undo its choices in Changes.</SettingHint>
      </div>
      <Switch id="glossary-auto-decide" checked={enabled} disabled={save.isPending}
        onCheckedChange={async (next) => { const result = await save.run(next); if (result.ok) router.refresh(); }} />
    </div>
    <ErrorNote error={save.error} />
  </div>;
}
