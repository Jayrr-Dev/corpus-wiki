import { describe, expect, it } from "vitest";
import { getReconciliationClient } from "./factory";

describe("getReconciliationClient", () => {
  it("uses the fake client when NEBIUS_API_KEY is not set", () => {
    expect(getReconciliationClient({ NODE_ENV: "test" }).name).toBe("fake");
  });

  it("uses the Token Factory client when NEBIUS_API_KEY is set", () => {
    const client = getReconciliationClient({ NODE_ENV: "test", NEBIUS_API_KEY: "test-key", AI_MODEL: "m" });
    expect(client.name).toBe("token-factory");
  });
});
