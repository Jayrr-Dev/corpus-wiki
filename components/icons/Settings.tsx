import { IconBase, type IconProps } from "./IconBase";

// SETTINGS: a hexagon nut with a round hole
export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 1.75 13.4 4.88v6.24L8 14.25 2.6 11.12V4.88Z" />
      <circle cx="8" cy="8" r="2" />
    </IconBase>
  );
}
