import { IconBase, type IconProps } from "./IconBase";

// INFO: an "i" in a circle (explains an action on hover)
export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.5v3.25" />
      <path d="M8 5.25h.01" />
    </IconBase>
  );
}
