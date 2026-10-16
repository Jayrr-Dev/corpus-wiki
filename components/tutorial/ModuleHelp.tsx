"use client";

import { usePathname } from "next/navigation";
import { HelpIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { getModuleTutorial } from "./moduleSteps";
import { openModuleTutorial } from "./tutorialStore";

export function ModuleHelp() {
  const pathname = usePathname();
  const tutorial = getModuleTutorial(pathname);
  if (!tutorial) return null;
  const label = `${tutorial.label} tutorial`;
  return <Tooltip content={label}><Button type="button" size="icon-xs" variant="ghost" aria-label={label} onClick={() => openModuleTutorial(pathname)}><HelpIcon className="size-4 text-muted-foreground" /></Button></Tooltip>;
}
