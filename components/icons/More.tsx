import { IconBase, type IconProps } from "./IconBase";

// MORE: three vertically stacked dots for action menus
export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <g fill="currentColor" stroke="none">
        <circle cx="8" cy="3" r="1.25" />
        <circle cx="8" cy="8" r="1.25" />
        <circle cx="8" cy="13" r="1.25" />
      </g>
    </IconBase>
  );
}
