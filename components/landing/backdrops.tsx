import { Mask } from "@/components/standard/mask";
import { Noise } from "@/components/standard/noise";
import { Screentone } from "@/components/standard/screentone";
import { Shader } from "@/components/standard/shader";

// =====================================================================
// LANDING BACKDROPS: Standards UI layers behind the hero, the tagline and
// the closing action. Each one goes inside a `relative isolate` section.
// Only two WebGL shaders on the page (hero, closing); the rest is CSS/SVG.
// Colours come from the landing palette in globals.css.
// =====================================================================

// HERO: a slow gold, ember and green mesh with dots and grain, all fading into
// the page together so nothing stops in a hard line at the section's edge
export function HeroBackdrop() {
  return (
    <Mask placement="behind" kind="fade" direction="bottom" softness={45}>
      <Shader
        kind="mesh-gradient"
        params={{ colors: ["#131209", "#8a5a1c", "#131209", "#496748", "#d9a441"], distortion: 0.8, swirl: 0.3 }}
        speed={0.25}
        opacity={0.45}
      />
      <Screentone kind="dots" tone="bottom" density={[0.4, 0]} size={7} color="var(--color-landing-gold)" opacity={0.18} />
      <Noise kind="grain" blend="overlay" opacity={0.12} />
    </Mask>
  );
}

// TAGLINE: printed ink clouds behind the promise
export function TaglineBackdrop() {
  return (
    <Mask placement="behind" kind="edges" softness={40}>
      <Screentone kind="dots" tone="clouds" density={[0.5, 0.05]} size={8} rough color="var(--color-landing-gold)" opacity={0.32} />
    </Mask>
  );
}

// CLOSING ACTION: an ember aurora under rings radiating from the button
export function CtaBackdrop() {
  return (
    <>
      <Mask placement="behind" kind="vignette" at="50% 55%" softness={65}>
        <Shader
          kind="aurora"
          params={{ colorBack: "#131209", colorFront: "#d9a441", colorAccent: "#496748", scale: 0.9 }}
          speed={0.4}
          opacity={0.5}
        />
      </Mask>
      <Mask placement="behind" kind="spotlight" at="50% 60%" softness={45}>
        <Screentone kind="rings" tone="center" at="50% 60%" density={[0.35, 0]} size={10} color="var(--color-landing-gold-pale)" opacity={0.12} />
      </Mask>
    </>
  );
}
