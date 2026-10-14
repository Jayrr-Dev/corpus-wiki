import { IconBase, type IconProps } from "./IconBase";

// CHANGE: change set, two offset squares
export function ChangeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="1" />
      <rect x="6.25" y="6.25" width="7.5" height="7.5" rx="1" />
    </IconBase>
  );
}
