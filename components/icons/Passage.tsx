import { IconBase, type IconProps } from "./IconBase";

// PASSAGE: located text, three lines
export function PassageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h7" />
    </IconBase>
  );
}
