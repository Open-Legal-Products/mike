import type { MetadataRoute } from "next";
import { publicPages } from "./page-content";
import { publicUpdates } from "./page-content";
import { ONTARIO_WORKFLOW_CATALOGUE } from "./generated-ontario-workflows";
import { siteConfig } from "./site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "",
    ...Object.keys(publicPages),
    ...publicUpdates.map((entry) => `updates/${entry.slug}`),
    ...ONTARIO_WORKFLOW_CATALOGUE.map((entry) => `workflows/${entry.slug}`),
  ];
  return paths.map((path) => ({
    url: `${siteConfig.websiteUrl}/${path}`,
    lastModified: new Date("2026-07-16"),
    changeFrequency:
      path === "updates" || path === "coverage" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
