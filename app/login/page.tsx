import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign in · Corpus Wiki" };

type LoginPageProps = { searchParams: Promise<{ next?: string; confirmation?: string }> };

// Account sign-in stays outside the app shell.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, confirmation } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-xs flex-col gap-5 rounded-lg border bg-sidebar p-6">
        <h1 className="text-title font-semibold">Corpus Wiki</h1>
        {confirmation === "failed" ? <p role="alert" className="text-panel text-destructive">That confirmation link is invalid or has expired. Try signing in, or create your account again to request a new link.</p> : null}
        <LoginForm next={next ?? "/"} />
        <p className="text-panel text-muted-foreground">New here? <Link href="/signup" className="text-link hover:underline">Create an account</Link></p>
      </div>
    </div>
  );
}
