import type { MetadataRoute } from "next";
import { siteConfig } from "./site-config";

export default function robots(): MetadataRoute.Robots {
  return siteConfig.publicLaunchApproved
    ? {
        rules: { userAgent: "*", allow: "/" },
        sitemap: `${siteConfig.websiteUrl}/sitemap.xml`,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
