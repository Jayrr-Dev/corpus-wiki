import { IconBase, type IconProps } from "./IconBase";

// ERROR LOG: a page of lines with a mark beside them
export function ErrorLogIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.75" y="1.75" width="10.5" height="12.5" rx="1.5" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h2.5" />
    </IconBase>
  );
}
