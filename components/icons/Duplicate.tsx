import { IconBase, type IconProps } from "./IconBase";

// DUPLICATE: two copies, overlapping squares
export function DuplicateIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.75" y="2.75" width="7" height="7" rx="1" />
      <rect x="6.25" y="6.25" width="7" height="7" rx="1" />
    </IconBase>
  );
}
