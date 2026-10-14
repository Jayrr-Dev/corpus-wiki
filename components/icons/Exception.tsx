import { IconBase, type IconProps } from "./IconBase";

// EXCEPTION: needs a person, a triangle
export function ExceptionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 2.25 14 13.25H2z" />
    </IconBase>
  );
}
