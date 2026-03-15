import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow calling Python serverless /api/scrape from server
  async rewrites() {
    return [];
  },
};

export default nextConfig;
