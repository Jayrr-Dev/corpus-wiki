"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setAllowExternalKnowledge } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

// EXTERNAL KNOWLEDGE: may AI that builds articles search the web for thin sections, or only use the files you uploaded
export function ExternalKnowledge({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  const router = useRouter();
  const save = useServerAction(setAllowExternalKnowledge);

  const apply = async (next: boolean) => {
    const result = await save.run(next);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor="external-knowledge" className="text-panel font-medium">Allow external knowledge</label>
          <SettingHint>When AI builds or updates an article and your own sources barely cover a section, it may search the web. Pages it uses are saved as external sources, and their knowledge only adds to yours. It never changes what your files say.</SettingHint>
        </div>
        <Switch id="external-knowledge" checked={enabled} disabled={save.isPending} onCheckedChange={(next) => void apply(next)} />
      </div>
      {enabled && !ready ? <p className="text-panel text-muted-foreground">Searching Wikipedia only. Add TAVILY_API_KEY to the server&apos;s environment to search the whole web.</p> : null}
      <ErrorNote error={save.error} />
    </div>
  );
}
