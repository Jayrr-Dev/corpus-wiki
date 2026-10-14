import { IconBase, type IconProps } from "./IconBase";

// SIGN OUT: leave, an open square with an arrow pointing out of it
export function SignOutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6.5 2.25h-3.25a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.25" />
      <path d="M6.5 8h7.25" />
      <path d="M11 5.25 13.75 8 11 10.75" />
    </IconBase>
  );
}
