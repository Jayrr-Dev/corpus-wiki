import "server-only";
import sharp from "sharp";

export const MAX_THUMBNAIL_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MIN_SOURCE_WIDTH = 240;
const ACCEPTED = new Set(["png", "jpeg", "webp", "gif"]);

const WIDTH = 960;
const HEIGHT = 600;
// Filling the card from a picture this far from its shape would cut off too much of it
const MAX_CROP = 0.55;

// True when a picture should sit whole on the card: every logo, and anything far from card shape
export function showsWhole(width: number, height: number, logo: boolean): boolean {
  const ratio = width / height, card = WIDTH / HEIGHT;
  return logo || 1 - Math.min(ratio, card) / Math.max(ratio, card) > MAX_CROP;
}

// CLEAN COPY: whatever was uploaded, what gets stored is a new 960 by 600 WebP that sharp
// decoded and rebuilt from pixels. The real format is read from the bytes, not the file's
// name, which keeps SVG out. Location and camera details are dropped along the way.
// Most pictures are cropped to fill the card. A logo or a very wide or tall picture is
// centred whole on its own main colour instead, so no words get cut off.
export async function cleanThumbnail(input: Uint8Array | ArrayBuffer, { logo = false }: { logo?: boolean } = {}): Promise<Buffer> {
  const bytes = Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("That image is too large. Use one under 20 MB.");
  const image = sharp(bytes, { limitInputPixels: 40_000_000 });
  const info = await image.metadata().catch(() => null);
  if (!info?.format || !ACCEPTED.has(info.format)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  if ((info.width ?? 0) < MIN_SOURCE_WIDTH) throw new Error(`That image is too small. Use one at least ${MIN_SOURCE_WIDTH} pixels wide.`);
  if (!showsWhole(info.width ?? 0, info.height ?? 1, logo)) {
    return image.rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer();
  }
  const { dominant } = await image.stats();
  const picture = await image.rotate().resize(Math.round(WIDTH * 0.8), Math.round(HEIGHT * 0.8), { fit: "inside" }).toBuffer();
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: dominant } }).composite([{ input: picture }]).webp({ quality: 80 }).toBuffer();
}
