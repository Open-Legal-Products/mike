import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    // The design system is the local @mike/shared package (file:../shared),
    // which lives one level up. Point Turbopack at the repo root so it may
    // bundle that out-of-app-dir source, and transpile it like first-party
    // code (this also resolves its React against this app's single copy, so
    // hooks — MikeIcon's useId, Radix internals — don't hit a duplicate React).
    turbopack: {
        root: path.resolve(__dirname, ".."),
    },
    transpilePackages: ["@mike/shared"],
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
