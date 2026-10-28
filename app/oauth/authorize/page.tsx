import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandMark";
import { parseAuthorizeRequest } from "@/lib/agents/oauth/authorizeRequest";
import { appOriginFromHeaders } from "@/lib/agents/oauth/origin";
import { requestClaims } from "@/lib/auth/claims";
import { readMySpaces } from "@/lib/spaces/server";
import { ConsentForm } from "./ConsentForm";

export const metadata: Metadata = { title: "Connect an agent · Corpus Wiki" };

type AuthorizePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The query string exactly as sent (repeated parameters kept, so the check can refuse them)
function queryOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, item);
  }
  return query;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-lg border bg-sidebar p-6">
        <h1><BrandLogo /></h1>
        {children}
      </div>
    </div>
  );
}

// OAUTH AUTHORIZE: an MCP client asks to act for the person. A bad client or
// redirect URI is shown here; other problems go back to the client. A
// signed-out person signs in first and comes back to this same request.
export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const query = queryOf(await searchParams);
  const issuer = appOriginFromHeaders(await headers());
  const parsed = await parseAuthorizeRequest(query, issuer);
  if (parsed.kind === "show") {
    return (
      <Frame>
        <h2 className="font-medium">This sign-in request cannot continue</h2>
        <p role="alert" className="text-panel text-muted-foreground">{parsed.message}</p>
        <p className="text-panel text-muted-foreground">Go back to the app that sent you here and try connecting again.</p>
      </Frame>
    );
  }
  if (parsed.kind === "redirect") redirect(parsed.url);

  const { data } = await requestClaims();
  if (typeof data?.claims?.sub !== "string") redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);

  const { spaces, activeSpace } = await readMySpaces();
  const { request } = parsed;
  return (
    <Frame>
      <ConsentForm
        query={query.toString()}
        clientName={request.client.name}
        clientId={request.client.client_id}
        verifiedHost={request.client.kind === "cimd" ? new URL(request.client.client_id).hostname : null}
        redirectHost={new URL(request.redirectUri).host}
        loopbackOnly={request.loopbackOnly}
        spaces={spaces.map((space) => ({ id: space.id, name: space.name }))}
        defaultSpaceId={activeSpace.id}
        requestedScopes={request.requestedScopes}
      />
    </Frame>
  );
}
