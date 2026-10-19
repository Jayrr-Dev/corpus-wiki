"use client";

import Image, { type ImageLoaderProps, type ImageProps } from "next/image";

// The browser requests our authenticated loader directly. The default Next.js
// optimizer cannot forward session cookies when fetching private source images.
const loader = ({ src, width }: ImageLoaderProps) => `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
export function MediaImage({ alt, width = 1600, height = 1200, sizes = "(max-width: 640px) 100vw, 800px", ...props }: Omit<ImageProps, "loader">) {
  const privateMedia = typeof props.src === "string" && /^\/api\/(assets|sources|composer)\//.test(props.src);
  return <Image {...props} alt={alt} width={width} height={height} sizes={sizes} loader={privateMedia ? loader : undefined} unoptimized={!privateMedia} />;
}
