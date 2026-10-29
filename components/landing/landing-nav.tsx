"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "Questions" },
];

const EASE = "ease-landing";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

// LANDING NAV: a compact bar floating off the top edge over a blur. On small
// screens the toggle opens a full height panel whose links arrive one by one.
export function LandingNav() {
  const [open, setOpen] = useState(false);

  // While the panel is open the page behind it stays put and Escape closes it
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <div className="flex w-full max-w-3xl items-center justify-between gap-6 rounded-2xl border border-white/10 bg-landing-base/60 px-4 py-2 backdrop-blur-xl">
          <Link href="/" aria-current="page" className={cn("flex items-center gap-2 rounded-lg py-1 text-white", FOCUS)}>
            <BrandMark className="size-6 text-landing-green-light" />
            <span className="font-brand text-xl">Corpus Wiki</span>
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {LINKS.map(link => (
              <a key={link.href} href={link.href} className={cn("rounded-md text-sm text-white/70 transition-colors duration-300 hover:text-white", EASE, FOCUS)}>
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className={cn("hidden rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors duration-300 hover:bg-white/10 active:scale-[0.98] md:inline-block", EASE, FOCUS)}>
              Sign in
            </Link>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="landing-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen(o => !o)}
              className={cn("relative z-50 grid size-10 place-items-center rounded-lg text-white transition-colors duration-300 hover:bg-white/10 md:hidden", FOCUS)}
            >
              <span aria-hidden className={cn("absolute h-0.5 w-6 rounded-full bg-current transition-transform duration-500", EASE, open ? "rotate-45" : "-translate-y-1")} />
              <span aria-hidden className={cn("absolute h-0.5 w-6 rounded-full bg-current transition-transform duration-500", EASE, open ? "-rotate-45" : "translate-y-1")} />
            </button>
          </div>
        </div>
      </nav>

      {/* MOBILE PANEL: full height, the base surface at high opacity over a strong blur */}
      <div
        id="landing-menu"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed inset-0 z-40 bg-landing-base/95 px-6 pt-24 backdrop-blur-2xl transition-opacity duration-300 md:hidden",
          EASE,
          open ? "opacity-100" : "pointer-events-none invisible opacity-0",
        )}
      >
        <ul className="flex flex-col gap-2">
          {[...LINKS, { href: "/login", label: "Sign in" }].map((link, i) => (
            <li
              key={link.href}
              // 60ms per link, capped so the whole entrance stays under 400ms
              style={{ transitionDelay: open ? `${Math.min(i * 60, 400)}ms` : "0ms" }}
              className={cn(
                "transition duration-500 motion-reduce:translate-y-0",
                EASE,
                open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
              )}
            >
              <a href={link.href} onClick={() => setOpen(false)} className={cn("block rounded-lg py-3 text-3xl font-semibold text-white", FOCUS)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
