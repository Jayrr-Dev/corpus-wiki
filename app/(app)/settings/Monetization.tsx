"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setMonetizationEnabled } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

// MONETIZATION: usage-based plans with session and weekly limits (docs/monetization-plan.md)
export function Monetization({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerAction(setMonetizationEnabled);

  const apply = async (next: boolean) => {
    const result = await save.run(next);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor="monetization" className="text-panel font-medium">Usage-based plans</label>
          <SettingHint>Meter AI use in credits with a 5-hour session limit and a weekly limit that resets on a fixed day, like Claude and ChatGPT plans. Off means AI use is only logged, never limited or charged.</SettingHint>
        </div>
        <Switch id="monetization" checked={enabled} disabled={save.isPending} onCheckedChange={(next) => void apply(next)} />
      </div>
      {enabled ? <p className="text-panel text-muted-foreground">Limits are not enforced yet; billing is still being built.</p> : null}
      <ErrorNote error={save.error} />
    </div>
  );
}
