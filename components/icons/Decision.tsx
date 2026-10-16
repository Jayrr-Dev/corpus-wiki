import { IconBase, type IconProps } from "./IconBase";

// DECISION: a recorded choice, shown as a checked clipboard.
export function DecisionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 3H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H11" />
      <rect x="5" y="1.5" width="6" height="3" rx="1" />
      <path d="m5.25 9 1.75 1.75 3.75-4" />
    </IconBase>
  );
}
