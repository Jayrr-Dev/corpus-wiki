import { publicWikiThumbnailPath } from "@/lib/publishing/server";
import { readPublicThumbnail } from "@/lib/publishing/thumbnailServer";

// PUBLIC THUMBNAIL: a Space's picture, for as long as the Space is published. The check runs
// on every request (the proxy marks this path no-store), so unpublishing cuts it off at once.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const path = await publicWikiThumbnailPath((await params).slug);
  const image = path ? await readPublicThumbnail(path) : null;
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(image, { headers: { "Content-Type": "image/webp" } });
}
