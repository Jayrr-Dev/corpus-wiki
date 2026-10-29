import type { NextConfig } from "next";

// NEXT CONFIG: uploads reach the server as a Server Action body, whose 1 MB default
// would refuse most PDFs and Word files (a video skips it: the browser puts it in Storage).
// ffmpeg-static and Whisper (transformers.js) load native files by path, so they stay unbundled.
const nextConfig: NextConfig = {
  // staleTimes.dynamic: the browser keeps a visited page for 30 seconds, so going back to it is instant
  // (the default 0 refetches every dynamic page on each click). router.refresh() and revalidatePath still clear it.
  experimental: { serverActions: { bodySizeLimit: "20mb" }, staleTimes: { dynamic: 30 } },
  serverExternalPackages: ["ffmpeg-static", "@huggingface/transformers"],
  // The landing page moved from /welcome to /
  async redirects() {
    return [{ source: "/welcome", destination: "/", permanent: true }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }, { key: "X-Content-Type-Options", value: "nosniff" }] },
      // Only the dedicated read-only renderer can be embedded externally.
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
