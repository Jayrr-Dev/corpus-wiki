import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Second Brain" };

type LoginPageProps = { searchParams: Promise<{ next?: string }> };

// SIGN IN: the one login (single user for the demo); outside the app shell
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-xs flex-col gap-5 rounded-lg border bg-sidebar p-6">
        <h1 className="text-title font-semibold">Second Brain</h1>
        <LoginForm next={next ?? "/"} />
      </div>
    </div>
  );
}
