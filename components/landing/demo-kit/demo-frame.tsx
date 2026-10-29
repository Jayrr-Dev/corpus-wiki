import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/landing/reveal";

// DEMO FRAME: one landing section around a demo. "centered" puts the heading
// on top and the demo full width below (glossary, agents, stakeholders);
// "split" puts the heading beside the demo (the live page hero layout).
// Heading and body follow the landing rules: 680px max, balanced lines.
export function DemoFrame({
  id, layout = "centered", eyebrow, title, body, action, children, className,
}: {
  id?: string;
  layout?: "centered" | "split";
  eyebrow?: string;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const heading = (
    <div className={cn(layout === "centered" && "mx-auto max-w-[680px] text-center")}>
      {eyebrow && <p className="text-sm font-semibold text-landing-gold">{eyebrow}</p>}
      <h2 className="mt-3 max-w-[680px] bg-linear-to-r from-landing-ink to-landing-fade bg-clip-text pb-1 text-3xl font-semibold tracking-tight text-balance text-transparent sm:text-5xl">{title}</h2>
      {body && <p className="mt-4 max-w-[680px] text-lg text-landing-ink/65 text-pretty sm:text-xl">{body}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );

  return (
    <section id={id} className={cn("scroll-mt-24 px-4 py-24 sm:px-6", className)}>
      <div className={cn("mx-auto w-full max-w-6xl", layout === "split" ? "grid items-center gap-12 lg:grid-cols-[4fr_7fr]" : "flex flex-col gap-16")}>
        <Reveal>{heading}</Reveal>
        <div aria-hidden className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
