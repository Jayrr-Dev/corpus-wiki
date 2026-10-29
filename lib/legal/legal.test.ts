import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/flags/server", () => ({
  isFeatureEnabled: async () => mocks.enabled,
  requireFeature: async () => { if (!mocks.enabled) mocks.notFound(); },
}));

import { LandingFooter } from "@/components/landing/landing-footer";
import ContactPage from "@/app/(marketing)/contact/page";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import { contactEmail, mailtoHref } from "./contact";
import { DATA_STORAGE_ANSWER, PRIVACY, TERMS } from "./content";

const PAGES = { privacy: PrivacyPage, terms: TermsPage, contact: ContactPage };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "hello@corpus.example");
});

describe("contact address", () => {
  it("reads a valid address and trims it", () => {
    expect(contactEmail(" hello@corpus.example ")).toBe("hello@corpus.example");
  });

  it("is null when unset, empty or not one plain address", () => {
    for (const value of ["", "   ", "nobody", "a@b", "a b@c.de", "a@b.c?bcc=x@y.z", "<a@b.cd>"]) expect(contactEmail(value)).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", undefined);
    expect(contactEmail()).toBeNull();
  });

  it("defaults to NEXT_PUBLIC_CONTACT_EMAIL", () => {
    expect(contactEmail()).toBe("hello@corpus.example");
  });

  it("builds a mailto link with an encoded subject", () => {
    expect(mailtoHref("a@b.cd")).toBe("mailto:a@b.cd");
    expect(mailtoHref("a@b.cd", "Privacy policy")).toBe("mailto:a@b.cd?subject=Privacy%20policy");
  });
});

describe("legal text", () => {
  const text = [DATA_STORAGE_ANSWER, ...[PRIVACY, TERMS].flatMap(doc => [doc.title, doc.summary, ...doc.sections.flatMap(s => [s.title, ...(s.paragraphs ?? []), ...(s.items ?? [])])])].join("\n");

  it("has no placeholder wording", () => {
    expect(text).not.toMatch(/placeholder|lorem|todo|tbd|\[[^\]]*\]|still needs? to be written|xxx/i);
  });

  it("names where data is stored and who processes it", () => {
    for (const fact of ["Supabase", "Nebius Token Factory", "Anthropic", "evidence", "delete your account"]) expect(text).toContain(fact);
    for (const fact of ["Supabase", "Nebius Token Factory", "Anthropic", "evidence", "delete your account"]) expect(DATA_STORAGE_ANSWER).toContain(fact);
  });
});

describe("legal pages", () => {
  it.each(Object.keys(PAGES) as (keyof typeof PAGES)[])("/%s is a 404 while legal_pages is off", async (name) => {
    await expect(PAGES[name]()).rejects.toThrow("404");
  });

  it.each(Object.keys(PAGES) as (keyof typeof PAGES)[])("/%s renders while legal_pages is on", async (name) => {
    mocks.enabled = true;
    const html = renderToStaticMarkup(await PAGES[name]());
    expect(html).toContain("mailto:hello@corpus.example");
    expect(html).not.toContain("(placeholder)");
  });

  it("/contact is a 404 without a contact address, even with the flag on", async () => {
    mocks.enabled = true;
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "");
    await expect(ContactPage()).rejects.toThrow("404");
  });

  it("the privacy policy leaves out its contact section without an address", async () => {
    mocks.enabled = true;
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "");
    const html = renderToStaticMarkup(await PrivacyPage());
    expect(html).toContain(PRIVACY.title);
    expect(html).not.toContain("mailto:");
  });
});

describe("landing footer", () => {
  const render = (legalPages: boolean, hasContact = true) => renderToStaticMarkup(createElement(LandingFooter, { legalPages, hasContact }));

  it("keeps today's disabled entries while legal_pages is off", () => {
    const html = render(false);
    for (const label of ["Privacy", "Terms", "Contact"]) expect(html).toContain(`${label} (placeholder)`);
    expect(html).not.toMatch(/href="\/(privacy|terms|contact)"/);
    expect(html).toContain('href="#product"');
  });

  it("links to the pages while legal_pages is on", () => {
    const html = render(true);
    for (const path of ["/privacy", "/terms", "/contact"]) expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain("(placeholder)");
  });

  it("leaves Contact disabled when no address is set", () => {
    const html = render(true, false);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Contact (placeholder)");
  });
});
