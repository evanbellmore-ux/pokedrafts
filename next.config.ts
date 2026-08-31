import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/raidcard", destination: "/raidcard.html" },
      { source: "/castmirror", destination: "/castmirror.html" },
      { source: "/CastMirror", destination: "/castmirror.html" },
    ];
  },
};

export default nextConfig;
