import { createHash } from "node:crypto";

// SHA-256 OF BYTES OR TEXT (hex): identical uploads are skipped by sources.hash
export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
