"use client";

import { useId } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

// =====================================================================
// PANEL ROWS: the control shapes every panel section is made of.
// =====================================================================

// SWITCH ROW: a label with an on/off switch at the right
export function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-panel text-muted-foreground">
        {label}
      </label>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

// SLIDER ROW: a label over a slider
export function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-panel text-muted-foreground">{label}</span>
      <Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([next]) => next !== undefined && onChange(next)} />
    </div>
  );
}

// SELECT ROW: a label with a small dropdown at the right
export function SelectRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-panel text-muted-foreground">
        {label}
      </label>
      <NativeSelect id={id} size="sm" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
