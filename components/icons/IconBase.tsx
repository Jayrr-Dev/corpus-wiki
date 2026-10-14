import type { ReactNode, SVGProps } from "react";

// SHARED ICON PROPS: every icon takes SVG props; size defaults to 16px
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

type IconBaseProps = IconProps & { children: ReactNode };

// ICON FRAME: 16x16 grid, 1.5px stroke, drawn in currentColor so icons never carry color
export function IconBase({ size = 16, children, ...props }: IconBaseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}
