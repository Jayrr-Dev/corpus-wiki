import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

it("rejects action posts and all mutations on the public reading surface", async () => {
  for (const path of ["/s/test", "/embed/test/wiki/page", "/explore"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`, { method, headers: { "next-action": "workspace-action" } }));
      expect(response.status).toBe(405);
    }
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  }
});
