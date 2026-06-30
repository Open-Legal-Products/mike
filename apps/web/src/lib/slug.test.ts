import { describe, expect, it } from "vitest";
import {
    buildSectionUrl,
    decodeNodeSlug,
    encodeNodeSlug,
    slugToPath,
} from "./slug";

describe("encodeNodeSlug / decodeNodeSlug", () => {
    it("round-trips a slug containing slashes", () => {
        const slug = "usc/title-49/chapter-145";
        expect(encodeNodeSlug(slug)).toBe("usc~title-49~chapter-145");
        expect(decodeNodeSlug(encodeNodeSlug(slug))).toBe(slug);
    });

    it("returns an empty string for an empty slug", () => {
        expect(encodeNodeSlug("")).toBe("");
    });
});

describe("slugToPath", () => {
    it("maps a usc slug under /sources/usc", () => {
        expect(slugToPath("usc/title-49")).toBe("/sources/usc/title-49");
    });

    it("maps a cfr slug under /sources/cfr", () => {
        expect(slugToPath("cfr/title-1/part-2")).toBe(
            "/sources/cfr/title-1/part-2",
        );
    });

    it("normalizes unicode dashes to ascii hyphens", () => {
        // U+2013 (en dash) should be normalized to a plain hyphen.
        expect(slugToPath("usc/title–49")).toBe("/sources/usc/title-49");
    });

    it("returns an empty string for an empty slug", () => {
        expect(slugToPath("")).toBe("");
    });
});

describe("buildSectionUrl", () => {
    it("zero-pads the title number to two digits", () => {
        expect(buildSectionUrl(5, "14501")).toBe(
            "/sources/usc/title-05/14501",
        );
    });

    it("leaves multi-digit titles unchanged", () => {
        expect(buildSectionUrl(49, "14501")).toBe(
            "/sources/usc/title-49/14501",
        );
    });
});
