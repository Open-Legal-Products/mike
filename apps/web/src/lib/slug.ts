/** Encode a tree slug containing `/` so it can live inside a Next.js dynamic segment. */
export function encodeNodeSlug(slug: string): string {
    if (!slug) {
        return "";
    }
    return slug.replace(/\//g, "~");
}

/** Decode the slug from the route segment back into its canonical form. */
export function decodeNodeSlug(segment: string): string {
    return segment.replace(/~/g, "/");
}

/**
 * Convert a backend slug to a frontend URL path.
 * Backend slugs match frontend URLs exactly now.
 * Examples:
 *   "usc/title-49" -> "/usc/title-49"
 *   "usc/title-49/subtitle-IV/part-B/chapter-145" -> "/usc/title-49/subtitle-IV/part-B/chapter-145"
 *   "usc/title-49/14501" -> "/usc/title-49/14501"
 */
const UNICODE_DASH_REGEX =
    /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function normalizeSlugDashes(value: string): string {
    return value.replace(UNICODE_DASH_REGEX, "-");
}

export function slugToPath(slug: string): string {
    if (!slug) {
        return "";
    }
    const normalized = normalizeSlugDashes(slug);

    // Handle CFR slugs: "cfr/title-1/..." -> "/sources/cfr/title-1/..."
    if (normalized.startsWith("cfr/")) {
        const cleanSlug = normalized.replace(/^cfr\//, "");
        return `/sources/cfr/${cleanSlug}`;
    }

    // Handle USC slugs: "usc/title-05" -> "/sources/usc/title-05"
    const cleanSlug = normalized.replace(/^usc\//, "");
    return `/sources/usc/${cleanSlug}`;
}

/**
 * Build a section URL from title and section numbers.
 * Format: "/sources/usc/title-{number}/{section_number}"
 */
export function buildSectionUrl(
    titleNumber: number,
    sectionNumber: string,
): string {
    const paddedTitle = titleNumber.toString().padStart(2, "0");
    const normalizedSection = normalizeSlugDashes(sectionNumber);
    return `/sources/usc/title-${paddedTitle}/${normalizedSection}`;
}
