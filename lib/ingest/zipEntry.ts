import { inflateRawSync } from "node:zlib";

// =====================================================================
// ZIP ENTRY: reads one file out of a .zip held in memory (stored or
// deflated entries, no Zip64, no encryption). Enough for a ChatGPT data
// export, whose conversations.json sits in a plain zip.
// =====================================================================

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
// A larger entry is refused before it is inflated (a zip bomb, or more than an upload can hold)
export const MAX_ZIP_ENTRY_BYTES = 200 * 1024 * 1024;

// True when the bytes start like a zip file ("PK\x03\x04", or an empty zip's "PK\x05\x06")
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

export type ZipEntryName = { name: string; read: () => Uint8Array };

// Every file in the zip's central directory, each read only when asked
export function zipEntries(bytes: Uint8Array): ZipEntryName[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntryName[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== DIRECTORY_ENTRY) throw new Error("This zip file is damaged.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, read: () => readEntry(bytes, view, { flags, method, compressedSize, size, localOffset }) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The end-of-central-directory record, searched from the end (it may be followed by a comment)
function findEndOfDirectory(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 22 - 0xffff); offset--) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  throw new Error("This zip file is damaged.");
}

type EntryHeader = { flags: number; method: number; compressedSize: number; size: number; localOffset: number };

function readEntry(bytes: Uint8Array, view: DataView, entry: EntryHeader): Uint8Array {
  if (entry.flags & 0x1) throw new Error("This zip file is password protected.");
  if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff) throw new Error("This zip file is too large to read.");
  if (entry.size > MAX_ZIP_ENTRY_BYTES) throw new Error("This zip file is too large to read.");
  const local = entry.localOffset;
  if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_HEADER) throw new Error("This zip file is damaged.");
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ZIP_ENTRY_BYTES }));
  throw new Error("This zip file uses a compression method that can't be read.");
}
