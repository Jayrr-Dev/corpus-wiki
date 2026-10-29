import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";
const LINK = `rounded-md transition-colors duration-300 hover:text-white ${FOCUS}`;

const LEGAL = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

// LANDING FOOTER: the brand and the page links. Pricing shows only while the billing flag
// is on, and Contact only when a contact address is set.
export function LandingFooter({ hasContact, pricing = false, onHome = true }: { hasContact: boolean; pricing?: boolean; onHome?: boolean }) {
  // On the landing page the section links are plain anchors; elsewhere they lead back to it
  const base = onHome ? "" : "/";
  return (
    <footer className="px-4 py-12 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2 text-white">
          <BrandMark className="size-6 text-landing-green-light" />
          <span className="font-brand text-xl">Corpus Wiki</span>
        </span>
        <ul className="flex flex-wrap items-center gap-6 text-sm text-white/60">
          <li><a href={`${base}#product`} className={LINK}>Product</a></li>
          <li><a href={`${base}#how`} className={LINK}>How it works</a></li>
          <li><a href={`${base}#faq`} className={LINK}>Questions</a></li>
          {pricing && <li><Link href="/pricing" className={LINK}>Pricing</Link></li>}
          {LEGAL.filter(({ href }) => href !== "/contact" || hasContact).map(({ href, label }) => (
            <li key={label}><Link href={href} className={LINK}>{label}</Link></li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
