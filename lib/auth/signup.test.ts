import { beforeEach, expect, it, vi } from "vitest";
import { signUp } from "./signup";

const mocks = vi.hoisted(() => ({ signup: vi.fn(), clearCookie: vi.fn(), reset: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { signUp: mocks.signup } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "http://localhost:3003" }), cookies: async () => ({ delete: mocks.clearCookie }) }));
vi.mock("@/lib/auth/currentPerson", () => ({ resetRequestActor: mocks.reset }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirected"); } }));
beforeEach(() => { vi.clearAllMocks(); mocks.signup.mockResolvedValue({ data: { session: null }, error: null }); });
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ email: "person@example.test", password: "long-enough-password", confirmation: "long-enough-password", name: "Example", ...values })) data.set(key, value);
  return data;
}
const initial = { error: null, message: null };

it("registers through Supabase with a confirmation callback and public name metadata", async () => {
  const result = await signUp(initial, form());
  expect(result.error).toBeNull();
  expect(result.message).toContain("Check your email");
  expect(mocks.signup).toHaveBeenCalledWith({ email: "person@example.test", password: "long-enough-password", options: { emailRedirectTo: "http://localhost:3003/auth/callback", data: { full_name: "Example" } } });
  expect(mocks.clearCookie).not.toHaveBeenCalled();
});

it("rejects invalid input before contacting the account service", async () => {
  const invalid: Record<string, string>[] = [{ email: "invalid" }, { password: "short", confirmation: "short" }, { confirmation: "different" }, { name: "x".repeat(81) }];
  for (const values of invalid) expect((await signUp(initial, form(values))).error).toBeTruthy();
  expect(mocks.signup).not.toHaveBeenCalled();
});

it("shows account-service errors and clears the previous space only after a successful session", async () => {
  mocks.signup.mockResolvedValueOnce({ data: {}, error: { message: "Email rate limit exceeded" } });
  expect((await signUp(initial, form())).error).toBe("Email rate limit exceeded");
  expect(mocks.clearCookie).not.toHaveBeenCalled();
  mocks.signup.mockResolvedValueOnce({ data: { session: { access_token: "test" } }, error: null });
  await expect(signUp(initial, form())).rejects.toThrow("redirected");
  expect(mocks.clearCookie).toHaveBeenCalledWith("second_brain_space");
  expect(mocks.reset).toHaveBeenCalledOnce();
});
