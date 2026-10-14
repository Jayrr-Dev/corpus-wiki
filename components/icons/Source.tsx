import { IconBase, type IconProps } from "./IconBase";

// SOURCE: uploaded file, a page with a cut corner
export function SourceIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.75 1.75h5.5l3 3v9.5h-8.5z" />
      <path d="M9.25 1.75v3h3" />
    </IconBase>
  );
}
