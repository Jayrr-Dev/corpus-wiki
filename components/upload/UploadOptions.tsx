"use client";

import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { UploadOptions as Options } from "@/lib/ingest/uploadOptions";
import { setUploadOptions } from "@/lib/server-actions/upload";

const SWITCHES: { key: keyof Options; label: string; hint: string }[] = [
  { key: "autoApprove", label: "Auto-approve", hint: "Accept new top-level domains instead of waiting in Exceptions. You can undo them in Changes." },
];

// How many switches are on, for the Options button
export function optionsOnCount(options: Options): number {
  return SWITCHES.filter(({ key }) => options[key]).length;
}

// UPLOAD OPTIONS: switches for every new upload in this space, saved as they change
export function UploadOptions({ options, onChange, onClose }: { options: Options; onChange: (next: Options) => void; onClose: () => void }) {
  const save = useServerAction(setUploadOptions, { progress: false, refreshTables: [] });
  const toggle = async (key: keyof Options, on: boolean) => {
    const previous = options;
    onChange({ ...options, [key]: on });
    const result = await save.run({ ...options, [key]: on });
    if (result.ok) onChange(result.options);
    else onChange(previous);
  };
  return (
    <div id="upload-options" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <p className="font-medium">Upload options</p>
          <InfoHint>Apply to every upload in this space until changed, including uploads already running.</InfoHint>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {SWITCHES.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center gap-2">
            <Switch id={`upload-option-${key}`} checked={options[key]} disabled={save.isPending} onCheckedChange={(on) => void toggle(key, on)} />
            <label htmlFor={`upload-option-${key}`} className="text-panel">{label}</label>
            <InfoHint>{hint}</InfoHint>
          </div>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}
