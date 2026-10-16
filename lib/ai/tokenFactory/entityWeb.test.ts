import { describe, expect, it } from "vitest";
import { iconCandidates, isPrivateAddress } from "@/lib/knowledge/logoFetch";
import { officialSite, readWebProfiles, readWebSites, siteNamesParty, readWebQueries, webHash, type WebResult, type WebSubject } from "./entityWeb";

const subject = (entityId: string, name: string): WebSubject => ({ entityId, name, kind: "company", aliases: [], relation: null, facts: [] });
const results: WebResult[] = [
  { title: "DM&E | Precision machining", url: "https://www.dme-example.com/about", content: "AS9100D certified machine shop." },
  { title: "DM&E - Wikipedia", url: "https://en.wikipedia.org/wiki/DME", content: "A railroad." },
];

describe("stakeholder web lookup", () => {
  it("keeps only sure matches with a summary and used results", () => {
    const subjects = [subject("a", "DM&E"), subject("b", "Boeing"), subject("c", "Vietnam")];
    const found = new Map([["a", results], ["b", results], ["c", results]]);
    const profiles = readWebProfiles({ profiles: [
      { ref: "E1", sameParty: true, reason: "Same certification", summary: "A precision machining manufacturer.", facts: [{ label: "Certification", value: "AS9100D", result: 1 }, { label: "Other", value: "x", result: 9 }], website: "https://www.dme-example.com/contact", results: [1] },
      { ref: "E2", sameParty: false, reason: "Railroad namesake", summary: "A railroad", facts: [], website: null, results: [2] },
      { ref: "E3", sameParty: true, reason: "", summary: "", facts: [], website: null, results: [1] },
    ] }, subjects, found);
    expect([...profiles.keys()]).toEqual(["a"]);
    expect(profiles.get("a")).toEqual({
      summary: "A precision machining manufacturer.",
      facts: [{ label: "Certification", value: "AS9100D", sourceIndex: 0 }, { label: "Other", value: "x", sourceIndex: null }],
      website: "https://www.dme-example.com",
      sources: [{ title: "DM&E | Precision machining", url: "https://www.dme-example.com/about" }],
    });
  });

  it("accepts an official site only when a result is on it, and never a guessed or odd scheme", () => {
    expect(officialSite("https://dme-example.com", results)).toBe("https://dme-example.com");
    expect(officialSite("https://guessed.example", results)).toBeNull();
    expect(officialSite("javascript:alert(1)", results)).toBeNull();
  });

  it("takes a site as the party's own only when its domain carries the party's name", () => {
    const party = (name: string, aliases: string[] = []) => ({ name, aliases });
    expect(siteNamesParty("https://www.asq.org", party("American Society for Quality (ASQ)"))).toBe(true);
    expect(siteNamesParty("https://gas.atco.com", party("ATCO Pipelines"))).toBe(true);
    expect(siteNamesParty("https://www.edmonton.ca", party("City of Edmonton"))).toBe(true);
    expect(siteNamesParty("https://utiliteksolutions.ca", party("Utilitek Solutions Inc."))).toBe(true);
    expect(siteNamesParty("https://www.faa.gov", party("FAA", ["Federal Aviation Administration"]))).toBe(true);
    expect(siteNamesParty("https://whmis.org", party("Labour Program"))).toBe(false);
  });

  it("takes a picked official site only from the results and only when the domain names the party", () => {
    const epcor = { ...subject("e", "EPCOR"), kind: "company" };
    const found = new Map([["e", [
      { title: "EPCOR Utilities", url: "https://www.epcor.com/ca/en.html", content: "" },
      { title: "Unrelated", url: "https://example.org", content: "" },
    ]]]);
    expect([...readWebSites({ sites: [{ ref: "E1", result: 1 }] }, [epcor], found)]).toEqual([["e", "https://www.epcor.com"]]);
    expect(readWebSites({ sites: [{ ref: "E1", result: 2 }] }, [epcor], found).size).toBe(0);
    expect(readWebSites({ sites: [{ ref: "E1", result: 7 }, { ref: "E2", result: 1 }] }, [epcor], found).size).toBe(0);
  });

  it("drops empty queries and looks up again when the name or kind changes", () => {
    const subjects = [subject("a", "DM&E"), subject("b", "Designer")];
    expect([...readWebQueries({ queries: [{ ref: "E1", query: " DM&E  machining " }, { ref: "E2", query: "" }] }, subjects)]).toEqual([["a", "DM&E machining"]]);
    expect(webHash(subjects[0]!)).toBe(webHash({ ...subjects[0]!, name: "dm&e " }));
    expect(webHash(subjects[0]!)).not.toBe(webHash({ ...subjects[0]!, kind: "organization" }));
  });
});

describe("logo fetching", () => {
  it("prefers the apple-touch-icon, then the largest icon, svg last", () => {
    const html = `<link rel="icon" href="/small.png" sizes="16x16"><link rel="icon" href="/logo.svg"><link rel=icon href=/big.png sizes="192x192"><link rel="apple-touch-icon" href="https://cdn.example.com/touch.png"><link rel="stylesheet" href="/x.css">`;
    expect(iconCandidates(html, "https://example.com/")).toEqual([
      "https://cdn.example.com/touch.png", "https://example.com/big.png", "https://example.com/small.png", "https://example.com/logo.svg",
    ]);
  });

  it("treats private, loopback and link-local addresses as private", () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(address)).toBe(true);
    for (const address of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(address)).toBe(false);
  });
});
