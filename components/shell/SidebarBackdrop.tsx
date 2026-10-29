import { Mask } from "@/components/standard/mask";
import { Noise } from "@/components/standard/noise";
import { Screentone } from "@/components/standard/screentone";

// SIDEBAR BACKDROP: faint ink clouds rising from the foot of the sidebar, with grain.
// CSS and SVG only (no WebGL): the sidebar is on every screen. The ink is the
// sidebar's own text colour, so it reads in light and dark themes alike.
export function SidebarBackdrop() {
  return (
    <>
      <Mask placement="behind" kind="fade" direction="top" softness={70}>
        <Screentone kind="dots" tone="clouds" density={[0.45, 0.05]} size={6} color="var(--color-sidebar-foreground)" opacity={0.09} />
      </Mask>
      <Noise placement="behind" kind="grain" blend="overlay" opacity={0.08} />
    </>
  );
}
