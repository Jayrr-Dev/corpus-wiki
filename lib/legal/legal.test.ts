import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
// The nav reads the session, which needs a request; these tests render the page text only
vi.mock("@/components/landing/site-nav", () => ({ SiteNav: () => null }));

import { LandingFooter } from "@/components/landing/landing-footer";
import ContactPage from "@/app/(marketing)/contact/page";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import { contactEmail, mailtoHref } from "./contact";
import { DATA_STORAGE_ANSWER, PRIVACY, TERMS } from "./content";

const PAGES = { privacy: PrivacyPage, terms: TermsPage, contact: ContactPage };

beforeEach(() => {
  vi.clearAllMocks();
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
  it.each(Object.keys(PAGES) as (keyof typeof PAGES)[])("/%s renders", (name) => {
    const html = renderToStaticMarkup(PAGES[name]());
    expect(html).toContain("<h1");
    expect(html).toContain("mailto:hello@corpus.example");
    expect(html).not.toContain("(placeholder)");
  });

  it("/contact is a 404 without a contact address", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "");
    expect(() => ContactPage()).toThrow("404");
  });

  it("the privacy policy leaves out its contact section without an address", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "");
    const html = renderToStaticMarkup(PrivacyPage());
    expect(html).toContain(PRIVACY.title);
    expect(html).not.toContain("mailto:");
  });
});

describe("landing footer", () => {
  const render = (hasContact = true) => renderToStaticMarkup(createElement(LandingFooter, { hasContact }));

  it("links to the legal pages", () => {
    const html = render();
    for (const path of ["/privacy", "/terms", "/contact"]) expect(html).toContain(`href="${path}"`);
    expect(html).toContain('href="#product"');
    expect(html).not.toContain("(placeholder)");
  });

  it("leaves Contact out when no address is set", () => {
    const html = render(false);
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain("Contact");
  });
});
