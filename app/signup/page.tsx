import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandMark";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account · Corpus Wiki" };
export default function SignupPage() {
  return <div className="flex min-h-dvh items-center justify-center bg-background p-6">
    <div className="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-sidebar p-6">
      <BrandLogo />
      <div><h1 className="text-title font-semibold">Create your account</h1><p className="mt-2 text-panel text-muted-foreground">Your own spaces for the topics you explore. Your wikis, uploads, and AI memory are private to you.</p></div>
      <SignupForm />
      <p className="text-panel text-muted-foreground">Already have an account? <Link className="text-link hover:underline" href="/login">Sign in</Link></p>
    </div>
  </div>;
}
