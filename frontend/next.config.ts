import type { NextConfig } from "next";

const REQUIRED_PUBLIC_BUILD_ENV = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    "NEXT_PUBLIC_API_BASE_URL",
] as const;

if (process.env.NODE_ENV === "production") {
    const missing = REQUIRED_PUBLIC_BUILD_ENV.filter(
        (key) => !process.env[key]?.trim(),
    );
    if (missing.length > 0) {
        throw new Error(
            `Missing required frontend build-time environment variables: ${missing.join(", ")}`,
        );
    }
}

const nextConfig: NextConfig = {
    /* config options here */
    // Standalone output emits a self-contained server (server.js + traced
    // node_modules) that runs without the repo — the desktop app bundles it
    // and runs it under Electron's own Node. Opt-in so the Docker image and
    // dev workflow are untouched.
    ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
        ? { output: "standalone" as const }
        : {}),
    reactCompiler: true,
    turbopack: {
        root: __dirname,
    },
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
    async redirects() {
        return [
            {
                source: "/account",
                destination: "/settings",
                permanent: true,
            },
            {
                source: "/account/:path*",
                destination: "/settings/:path*",
                permanent: true,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
