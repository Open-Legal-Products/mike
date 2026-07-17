import type { Metadata } from "next";
import "./globals.css";
import { siteConfig } from "./site-config";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.websiteUrl),
  title: {
    default: "ROSS — Ontario-first legal work, built in the open",
    template: "%s | ROSS",
  },
  description: "An invitation-only, open-source legal AI workspace in development for Ontario lawyers and paralegals.",
  applicationName: "ROSS",
  openGraph: {
    type: "website",
    siteName: "ROSS",
    title: "ROSS — Ontario-first legal work, built in the open",
    description: "An open-source legal workspace in development for Ontario lawyers and paralegals.",
  },
  robots: {
    index: siteConfig.publicLaunchApproved,
    follow: siteConfig.publicLaunchApproved,
  },
  other: {
    "codex-preview": siteConfig.publicLaunchApproved
      ? "production-reviewed"
      : "development",
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
