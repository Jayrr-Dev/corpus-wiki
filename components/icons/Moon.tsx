import { IconBase, type IconProps } from "./IconBase";

// MOON: a crescent (dark theme)
export function MoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13.25 9.5A5.5 5.5 0 1 1 6.5 2.75a4.25 4.25 0 0 0 6.75 6.75Z" />
    </IconBase>
  );
}
