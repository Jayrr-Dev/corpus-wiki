import { IconBase, type IconProps } from "./IconBase";

// HELP: a question mark in a circle (opens the tutorial)
export function HelpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.45.2-.75.6-.75 1.1v.3" />
      <path d="M8 11.25h.01" />
    </IconBase>
  );
}
