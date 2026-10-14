import type { NextConfig } from "next";

// NEXT CONFIG: uploads reach the server as a Server Action body, whose 1 MB default
// would refuse most PDFs and Word files
const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
