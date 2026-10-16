"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/standard/tooltip";
import { OUTPUT_SKILLS, type OutputSkillId } from "@/lib/chatbot/outputSkills";

export function OutputSkillPicker({ value, onChange, disabled }: { value: OutputSkillId; onChange: (value: OutputSkillId) => void; disabled: boolean }) {
  const selected = OUTPUT_SKILLS.find(skill => skill.id === value)!;
  return <DropdownMenu>
    <Tooltip content="Choose how the answer is written. All styles use humanized wording.">
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Output style: ${selected.label}`} className="min-w-0">
          <span className="truncate">{selected.id === "natural" ? "Output style" : selected.label}</span><ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
    </Tooltip>
    <DropdownMenuContent side="top" align="start" className="w-72">
      {OUTPUT_SKILLS.map(skill => <DropdownMenuItem key={skill.id} onSelect={() => onChange(skill.id)} aria-label={skill.label}>
        <span className="min-w-0 flex-1"><span className="block font-medium">{skill.label}</span><span className="block text-xs text-muted-foreground">{skill.description}</span></span>
        {value === skill.id && <Check className="size-4 shrink-0" />}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
