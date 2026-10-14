import { IconBase, type IconProps } from "./IconBase";

// UPLOAD: upload, a triangle over a line
export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3 12 9H4z" />
      <path d="M3 12.75h10" />
    </IconBase>
  );
}
