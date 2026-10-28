import { expect, it } from "vitest";
import { fetchPublicJson, isBlockedAddress } from "./safeFetch";

it("blocks private, loopback, link-local and mapped addresses", () => {
  for (const address of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:a00:1", "::ffff:7f00:1", "ff02::1", "not an ip",
  ]) expect(isBlockedAddress(address), address).toBe(true);
});

it("allows public addresses", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedAddress(address), address).toBe(false);
});

it("refuses http, literal private IPs and localhost before connecting", async () => {
  await expect(fetchPublicJson("http://example.com/client.json")).rejects.toThrow(/https/);
  await expect(fetchPublicJson("https://127.0.0.1/client.json")).rejects.toThrow(/may not reach/);
  await expect(fetchPublicJson("https://[::1]/client.json")).rejects.toThrow(/may not reach/);
  await expect(fetchPublicJson("https://[::ffff:10.0.0.1]/client.json")).rejects.toThrow(/may not reach/);
  await expect(fetchPublicJson("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/may not reach/);
  await expect(fetchPublicJson("https://localhost/client.json")).rejects.toThrow(/this computer/);
});
