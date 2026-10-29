"use client";

import { useTheme } from "next-themes";
import { Tooltip } from "@/components/standard/tooltip";
import { MoonIcon, SunIcon } from "@/components/icons";

// THEME SWITCH: a small icon button that flips between light and dark, beside Sign out
// Both icons render and CSS picks one, so the server markup matches before the theme is known
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Tooltip content="Switch theme">
      <button
        type="button"
        aria-label="Switch theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden [&>svg]:size-4"
      >
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
      </button>
    </Tooltip>
  );
}
