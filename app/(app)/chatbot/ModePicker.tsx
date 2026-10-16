"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/standard/tooltip";

const MODES = [
  { agent: false, label: "Ask", description: "Answers from your knowledge only. Changes nothing." },
  { agent: true, label: "Agent", description: "Can also create articles and import source links on request." },
] as const;

export function ModePicker({ agent, onChange, disabled }: { agent: boolean; onChange: (agent: boolean) => void; disabled: boolean }) {
  const selected = MODES.find(mode => mode.agent === agent)!;
  return <DropdownMenu>
    <Tooltip content="Choose whether the chat can act on your knowledge base or only answer.">
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Mode: ${selected.label}`} className="min-w-0">
          <span className="truncate">{selected.label}</span><ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
    </Tooltip>
    <DropdownMenuContent side="top" align="start" className="w-72">
      {MODES.map(mode => <DropdownMenuItem key={mode.label} onSelect={() => onChange(mode.agent)} aria-label={mode.label}>
        <span className="min-w-0 flex-1"><span className="block font-medium">{mode.label}</span><span className="block text-xs text-muted-foreground">{mode.description}</span></span>
        {agent === mode.agent && <Check className="size-4 shrink-0" />}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
