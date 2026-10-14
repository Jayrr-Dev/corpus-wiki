import { IconBase, type IconProps } from "./IconBase";

// GRAPH: three dots joined, the graph view
export function GraphIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="4" cy="4.5" r="1.75" />
      <circle cx="12" cy="6" r="1.75" />
      <circle cx="6.5" cy="12" r="1.75" />
      <path d="M5.7 4.8l4.6.9M10.9 7.4l-3.3 3.3M4.6 6.2l1.3 4.1" />
    </IconBase>
  );
}
