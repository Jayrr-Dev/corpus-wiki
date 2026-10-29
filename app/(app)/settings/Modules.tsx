"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import type { ModuleKey } from "@/lib/modules";
import { setModuleSwitch } from "./moduleActions";
import { SettingHint } from "./SettingHint";

// The three modules in nav order (docs/knowledge-modules-plan.md); keep in step with MODULE_KEYS in lib/modules.ts
const MODULES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: "study", label: "Study", hint: "Practice questions and flashcards from your knowledge." },
  { key: "video", label: "Video", hint: "Narrated videos from a topic or article." },
  { key: "docs", label: "Docs", hint: "Step-by-step technical docs from your knowledge." },
];

// MODULES: one switch each for Study, Video and Docs, all off by default
export function Modules({ enabled }: { enabled: readonly ModuleKey[] }) {
  const router = useRouter();
  const save = useServerAction(setModuleSwitch);

  // refresh so the sidebar shows or hides the module's link
  const apply = async (key: ModuleKey, next: boolean) => {
    const result = await save.run(key, next);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <h3 className="font-medium">Modules</h3>
        <SettingHint>Turning a module off hides it. Its data stays.</SettingHint>
      </div>
      <div className="flex flex-col gap-2">
        {MODULES.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`module-${item.key}`} className="text-panel font-medium">{item.label}</label>
              <SettingHint>{item.hint}</SettingHint>
            </div>
            <Switch id={`module-${item.key}`} checked={enabled.includes(item.key)} disabled={save.isPending} onCheckedChange={(next) => void apply(item.key, next)} />
          </div>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}
