import type { NextConfig } from "next";

// NEXT CONFIG: uploads reach the server as a Server Action body, whose 1 MB default
// would refuse most PDFs and Word files (a video skips it: the browser puts it in Storage).
// ffmpeg-static and Whisper (transformers.js) load native files by path, so they stay unbundled.
const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  serverExternalPackages: ["ffmpeg-static", "@huggingface/transformers"],
};

export default nextConfig;
