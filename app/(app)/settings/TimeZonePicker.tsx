"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTimeZone } from "@/app/(app)/_components/DateTime";
import { TIME_ZONE_COOKIE } from "@/app/(app)/_lib/format";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SettingHint } from "./SettingHint";

const ONE_YEAR = 60 * 60 * 24 * 365;

// TIME ZONE: which zone dates and times show in, remembered in a cookie on this device
export function TimeZonePicker({ zones }: { zones: string[] }) {
  const router = useRouter();
  const current = useTimeZone();
  const [isPending, startTransition] = useTransition();

  const apply = (zone: string) => {
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  };

  const applyDeviceZone = () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zones.includes(zone)) apply(zone);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor="time-zone" className="text-panel font-medium">Time zone</label>
        <SettingHint>Dates and times across the workspace show in this zone. Days on their own (a source&apos;s date) stay as written.</SettingHint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect id="time-zone" className="w-72 max-w-full [&>select]:h-9" value={current} disabled={isPending} onChange={(event) => apply(event.target.value)}>
          {zones.map((zone) => (
            <NativeSelectOption key={zone} value={zone}>{zone.replaceAll("_", " ")}</NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="button" size="lg" variant="outline" disabled={isPending} onClick={applyDeviceZone}>
          Use this device&apos;s zone
        </Button>
      </div>
    </div>
  );
}
