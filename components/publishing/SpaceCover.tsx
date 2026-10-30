import { spaceCover } from "@/lib/publishing/thumbnail";
import { cn } from "@/lib/utils";

// SPACE COVER: the Space's picture over its drawn cover. The drawing sits underneath, so a
// Space with no picture, or one that fails to load, still shows something of its own.
export function SpaceCover({ slug, title, version, className }: { slug: string; title: string; version: string | null; className?: string }) {
  const cover = spaceCover(slug, title);
  return (
    <div className={cn("relative aspect-[8/5] overflow-hidden", className)} style={{ backgroundColor: cover.base }}>
      <svg aria-hidden viewBox="0 0 480 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        {cover.circles.map(circle => <circle key={`${circle.cx}:${circle.cy}`} {...circle} opacity={0.9} />)}
        <circle cx="240" cy="150" r="68" fill={cover.base} />
        <text x="240" y="150" textAnchor="middle" dominantBaseline="central" fontSize="72" className="fill-white font-brand">{cover.initial}</text>
      </svg>
      {/* A background, not an img: a picture that fails leaves the cover, with no broken-image mark */}
      {version && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(/api/public-wiki/thumbnail/${slug}?v=${version})` }} />}
    </div>
  );
}
