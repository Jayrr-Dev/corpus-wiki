import { parseHTML } from "linkedom";
import { sha256 } from "./hash";
import type { ImageDescriber } from "./describeMedia";
import type { ExtractedPage } from "./passages";

// =====================================================================
// WORD (.docx): the document's text, plus every picture embedded in it.
// Each picture is stored on its own and read by the vision model; its
// description becomes passages at the picture's place in the text, which
// remember the stored picture (location.figure), so an article citing
// them can show it. Pictures the browser cannot show are skipped.
// =====================================================================

// WHAT READING A .docx NEEDS BESIDES THE BYTES: the vision model and a place to keep pictures.
// Without either, only the text is read (an upload never fails over a picture).
export type DocxContext = {
  fileName: string;
  describeImage?: ImageDescriber | null;
  storeFigure?: ((path: string, bytes: Uint8Array, mimeType: string) => Promise<string>) | null;
};

// Pictures a vision model can read and an <img> can show (Word also embeds EMF/WMF drawings)
const FIGURE_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };

// Smaller pictures are icons, bullets and logos, not figures worth a model call (a 7.6 KB
// push-pin clip art was read as a "figure"; the smallest real drawing seen was 57 KB)
const MIN_FIGURE_BYTES = 10 * 1024;

// How many pictures are described at once
const DESCRIBE_CONCURRENCY = 3;

// A mark no document contains, standing in for picture n in the text until it is described
const MARK = "⁣";
const markOf = (index: number) => `${MARK}FIGURE:${index}${MARK}`;
const MARK_PATTERN = new RegExp(`${MARK}FIGURE:(\\d+)${MARK}`);

type Embedded = { bytes: Uint8Array; mimeType: string };

export async function readDocx(bytes: Uint8Array, context?: DocxContext): Promise<ExtractedPage[]> {
  const { default: mammoth } = await import("mammoth");
  const embedded: Embedded[] = [];
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      embedded.push({ bytes: new Uint8Array(await image.read()), mimeType: image.contentType });
      return { src: String(embedded.length - 1) };
    }),
  });
  const figures = context?.describeImage && context.storeFigure ? await describeFigures(embedded, context) : new Map<number, ExtractedPage>();
  return docxPages(html, figures);
}

// The HTML as plain paragraphs, each picture replaced by its description (when it has one)
export function docxPages(html: string, figures: ReadonlyMap<number, ExtractedPage>): ExtractedPage[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll("img").forEach((img) => img.replaceWith(document.createTextNode(`\n\n${markOf(Number(img.getAttribute("src")))}\n\n`)));
  document.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,td,th,tr,br").forEach((node) => node.appendChild(document.createTextNode("\n\n")));
  const text = (document.body.textContent ?? "").replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n");
  const pages: ExtractedPage[] = [];
  // Splitting on the mark alternates text and picture numbers: text, n, text, n, text
  text.split(MARK_PATTERN).forEach((piece, index) => {
    if (index % 2 === 1) {
      const figure = figures.get(Number(piece));
      if (figure) pages.push(figure);
    } else if (piece.trim()) pages.push({ page: null, text: piece.trim() });
  });
  return pages;
}

// Stores and describes each picture worth reading; a picture that fails is left out, not fatal
async function describeFigures(embedded: Embedded[], context: DocxContext): Promise<Map<number, ExtractedPage>> {
  const figures = new Map<number, ExtractedPage>();
  const wanted = embedded.map((image, index) => ({ ...image, index })).filter((image) => FIGURE_TYPES[image.mimeType] && image.bytes.byteLength >= MIN_FIGURE_BYTES);
  let next = 0;
  const work = async () => {
    while (next < wanted.length) {
      const image = wanted[next++]!;
      const number = wanted.indexOf(image) + 1;
      try {
        const path = await context.storeFigure!(`figures/${sha256(image.bytes)}${FIGURE_TYPES[image.mimeType]}`, image.bytes, image.mimeType);
        // The number is added here, not told to the model, which would repeat it ("Figure 3: Figure 3 is")
        const description = await context.describeImage!({ bytes: image.bytes, mimeType: image.mimeType, fileName: `a picture in ${context.fileName}` });
        if (description.trim()) figures.set(image.index, { page: null, text: `Figure ${number}: ${description.trim()}`, figure: path });
      } catch (error) {
        console.error(`Figure ${number} of ${context.fileName} could not be read:`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DESCRIBE_CONCURRENCY, wanted.length) }, work));
  return figures;
}
