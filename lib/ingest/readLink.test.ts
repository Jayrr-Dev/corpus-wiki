import { describe, expect, it } from "vitest";
import { isPublicAddress, linkUrl, pageText } from "./readLink";

describe("link imports", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1"])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it.each(["file:///etc/passwd", "ftp://example.com", "https://user:password@example.com", "https://example.com:3000", "not a URL"])("rejects unsupported link %s", (url) => {
    expect(() => linkUrl(url)).toThrow();
  });
  it("normalizes links and removes fragments", () => {
    expect(linkUrl(" https://example.com/article#section ").href).toBe("https://example.com/article");
    expect(linkUrl("http://2130706433").hostname).toBe("127.0.0.1");
  });
  it("extracts readable article text, decodes entities and removes non-content", () => {
    const page = pageText('<html><head><title>A &amp; B</title></head><body><nav>Navigation</nav><main><h1>Heading</h1><p>First &amp; second.</p><p>Third.</p><script>evil()</script><span hidden>Hidden</span></main><footer>Footer</footer></body></html>');
    expect(page.title).toBe("A & B");
    expect(page.text).toContain("First & second.\nThird.");
    expect(page.text).not.toMatch(/evil|Hidden|Navigation|Footer/);
  });
});
