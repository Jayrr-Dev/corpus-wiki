import { IconBase, type IconProps } from "./IconBase";

// LINK: relationship, two circles joined
export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="4.25" cy="8" r="2.25" />
      <circle cx="11.75" cy="8" r="2.25" />
      <path d="M6.5 8h3" />
    </IconBase>
  );
}
