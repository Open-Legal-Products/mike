import brand from "../../../../config/ross-brand.json";

const { product, urls } = brand;

export const rossBrand = {
    name: product.name,
    expandedName: product.expandedName,
    tagline: product.tagline,
    description: product.description,
    betaLabel: product.betaLabel,
    appUrl: process.env.NEXT_PUBLIC_ROSS_APP_URL ?? urls.app,
    websiteUrl: process.env.NEXT_PUBLIC_ROSS_WEBSITE_URL ?? urls.website,
    termsUrl: `${process.env.NEXT_PUBLIC_ROSS_WEBSITE_URL ?? urls.website}/terms`,
    privacyUrl: `${process.env.NEXT_PUBLIC_ROSS_WEBSITE_URL ?? urls.website}/privacy`,
} as const;
