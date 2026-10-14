import { IconBase, type IconProps } from "./IconBase";

// UNDO: undo, a half circle with an arrowhead
export function UndoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 10.5a4.5 4.5 0 0 1 9 0" />
      <path d="M1.75 8.5 3.5 10.5 5.5 8.75" />
    </IconBase>
  );
}
