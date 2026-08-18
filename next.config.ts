import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/raidcard", destination: "/raidcard.html" }];
  },
};

export default nextConfig;
