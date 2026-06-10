import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: "/sitemap.xml",
        destination: "/api/sitemap/sitemap.xml",
      },
      {
        source: "/sitemap_:slug.xml",
        destination: "/api/sitemap/sitemap_:slug.xml",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
