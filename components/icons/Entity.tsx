import { IconBase, type IconProps } from "./IconBase";

// ENTITY: real thing, a small filled square
export function EntityIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="0.5" fill="currentColor" />
    </IconBase>
  );
}
