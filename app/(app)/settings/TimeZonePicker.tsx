"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTimeZone } from "@/app/(app)/_components/DateTime";
import { TIME_ZONE_COOKIE } from "@/app/(app)/_lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingHint } from "./SettingHint";

const ONE_YEAR = 60 * 60 * 24 * 365;

// TIME ZONE: which zone dates and times show in, remembered in a cookie on this device
export function TimeZonePicker({ zones }: { zones: string[] }) {
  const router = useRouter();
  const current = useTimeZone();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredZones = zones.filter((zone) => zone.replaceAll("_", " ").toLowerCase().includes(search.replaceAll("_", " ").trim().toLowerCase()));

  const apply = (zone: string) => {
    setOpen(false);
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
        <Popover open={open} onOpenChange={(next) => { setOpen(next); setSearch(""); setActive(0); }}>
          <PopoverTrigger asChild>
            <Button id="time-zone" type="button" variant="outline" size="lg" className="w-72 max-w-full justify-between" disabled={isPending}>
              <span className="truncate">{current.replaceAll("_", " ")}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>
            <Input
              ref={inputRef}
              role="combobox"
              aria-label="Search time zones"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filteredZones[active] ? `${listId}-${active}` : undefined}
              placeholder="Search time zones…"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setActive(0); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (filteredZones[active]) apply(filteredZones[active]);
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = Math.max(0, Math.min(filteredZones.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
                  setActive(next);
                  document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
                }
              }}
            />
            <div id={listId} role="listbox" aria-label="Time zones" className="max-h-64 overflow-y-auto">
              {filteredZones.map((zone, index) => (
                <div key={zone} id={`${listId}-${index}`} role="option" aria-selected={zone === current}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-panel ${index === active ? "bg-accent text-accent-foreground" : ""}`}
                  onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => apply(zone)}>
                  {zone.replaceAll("_", " ")}
                  {zone === current && <Check className="size-4 shrink-0" />}
                </div>
              ))}
              {filteredZones.length === 0 && <p className="px-2 py-3 text-panel text-muted-foreground">No time zones found.</p>}
            </div>
          </PopoverContent>
        </Popover>
        <Button type="button" size="lg" variant="outline" disabled={isPending} onClick={applyDeviceZone}>
          Use this device&apos;s zone
        </Button>
      </div>
    </div>
  );
}
