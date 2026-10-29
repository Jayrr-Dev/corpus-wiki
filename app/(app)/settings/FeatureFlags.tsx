"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Switch } from "@/components/ui/switch";
import { setFeatureFlag } from "@/lib/flags/actions";
import { FEATURE_FLAGS, FEATURE_ONLY_KEYS, type FeatureFlagKey, type FeatureFlags as Flags } from "@/lib/flags/registry";
import { SettingHint } from "./SettingHint";

// FEATURE FLAGS: one switch per registered flag (lib/flags/registry.ts), app-wide.
// Defaults to the features; Settings passes the sidebar modules as a second list.
export function FeatureFlags({ flags, keys = FEATURE_ONLY_KEYS, title = "Feature flags", hint = "Unfinished features, off by default. A switch here applies to every space." }: { flags: Flags; keys?: readonly FeatureFlagKey[]; title?: string; hint?: string }) {
  const router = useRouter();
  const save = useServerAction(setFeatureFlag);
  const [saving, setSaving] = useState<FeatureFlagKey | null>(null);

  const apply = async (key: FeatureFlagKey, next: boolean) => {
    setSaving(key);
    const result = await save.run(key, next);
    setSaving(null);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <h3 className="font-medium">{title}</h3>
        <SettingHint>{hint}</SettingHint>
      </div>
      <ul className="flex flex-col gap-3">
        {keys.map((key) => {
          const id = `feature-flag-${key}`;
          return (
            <li key={key} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <label htmlFor={id} className="text-panel font-medium">{FEATURE_FLAGS[key].label}</label>
                <SettingHint>{FEATURE_FLAGS[key].description}</SettingHint>
              </div>
              <Switch id={id} checked={flags[key]} disabled={saving !== null} onCheckedChange={(next) => void apply(key, next)} />
            </li>
          );
        })}
      </ul>
      <ErrorNote error={save.error} />
    </div>
  );
}
