// AI SEAM: types, the fake client and the provider constants. The factory is
// server-only and imported from "@/lib/ai/factory" so the key never reaches a browser.
export { PROMPT_VERSION, TOKEN_FACTORY_BASE_URL } from "./config";
export { FakeReconciliationClient } from "./fake/FakeReconciliationClient";
export type * from "./types";
