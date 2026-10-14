import { IconBase, type IconProps } from "./IconBase";

// PAGE: wiki page, a square with three lines
export function PageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1" />
      <path d="M5.25 6h5.5M5.25 8h5.5M5.25 10h3.5" />
    </IconBase>
  );
}
