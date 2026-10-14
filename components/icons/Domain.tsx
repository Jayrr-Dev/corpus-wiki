import { IconBase, type IconProps } from "./IconBase";

// DOMAIN: domain, a square in a square
export function DomainIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1" />
      <rect x="5.5" y="5.5" width="5" height="5" rx="0.5" />
    </IconBase>
  );
}
