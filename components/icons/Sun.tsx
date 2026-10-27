import { IconBase, type IconProps } from "./IconBase";

// SUN: a circle with short rays (light theme)
export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.75v1.25M8 13v1.25M1.75 8H3M13 8h1.25M3.6 3.6l.9.9M11.5 11.5l.9.9M3.6 12.4l.9-.9M11.5 4.5l.9-.9" />
    </IconBase>
  );
}
