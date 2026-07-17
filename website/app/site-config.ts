import brand from "../../config/ross-brand.json";

export const siteConfig = {
  name: brand.product.name,
  expandedName: brand.product.expandedName,
  websiteUrl: process.env.NEXT_PUBLIC_ROSS_WEBSITE_URL ?? brand.urls.website,
  appUrl: process.env.NEXT_PUBLIC_ROSS_APP_URL ?? brand.urls.app,
  sourceUrl: brand.urls.source,
  upstreamUrl: brand.urls.upstreamSource,
  supportUrl: brand.urls.support,
  securityUrl: brand.urls.security,
  operator: brand.product.legalOperator,
  launchMode: brand.product.betaLabel,
  coverageStatus: brand.policy.coverageStatus === "foundation-only"
    ? "Foundation only — Ontario and Canadian source integrations are not live yet"
    : brand.policy.coverageStatus,
  socialLinks: brand.socialLinks,
} as const;

export const primaryNav = [
  { href: "/ontario", label: "Ontario" },
  { href: "/features", label: "Features" },
  { href: "/workflows", label: "Workflows" },
  { href: "/coverage", label: "Coverage" },
  { href: "/open-source", label: "Open source" },
] as const;

export const footerGroups = [
  { title: "Product", links: [["Ontario", "/ontario"], ["Features", "/features"], ["Workflows", "/workflows"], ["Coverage", "/coverage"], ["Updates", "/updates"]] },
  { title: "Trust", links: [["Security", "/security"], ["Privacy", "/privacy"], ["Responsible AI", "/responsible-ai"], ["Accessibility", "/accessibility"], ["Subprocessors", "/subprocessors"]] },
  { title: "Project", links: [["About", "/about"], ["Open source", "/open-source"], ["Documentation", "/docs"], ["Contact", "/contact"], ["Status", "/status"]] },
  { title: "Legal", links: [["Terms", "/terms"], ["Acceptable use", "/acceptable-use"], ["Licence", "https://github.com/ranade-oss/ROSS-RanadeOSS/blob/main/LICENSE"], ["Mike upstream", "https://github.com/Open-Legal-Products/mike"]] },
] as const;
