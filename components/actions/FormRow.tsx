import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type FormRowProps = { htmlFor: string; label: string; children: ReactNode };

// FORM ROW: a label above its control (dialogs and forms share it)
export function FormRow({ htmlFor, label, children }: FormRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
