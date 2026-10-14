import { IconBase, type IconProps } from "./IconBase";

// UNIT: knowledge unit, a circle
export function UnitIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5" />
    </IconBase>
  );
}
