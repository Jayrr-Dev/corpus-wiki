import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type SelectOption = { value: string; label: string };

type OptionSelectProps = {
  id?: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  // shown as the first option with value "" (e.g. "Any kind", "Keep current")
  emptyLabel?: string;
  className?: string;
};

// OPTION SELECT: a native select over value/label pairs (filters and the ActionDialog)
export function OptionSelect({ id, label, value, options, onChange, emptyLabel, className }: OptionSelectProps) {
  return (
    <NativeSelect id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {emptyLabel !== undefined ? <NativeSelectOption value="">{emptyLabel}</NativeSelectOption> : null}
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

// Options from enum values, labelled with spaces instead of underscores
export function enumOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
}
