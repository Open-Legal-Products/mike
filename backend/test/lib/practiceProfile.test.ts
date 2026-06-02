import { describe, it, expect, vi } from "vitest";
import { formatPracticeProfile } from "../../src/lib/chatTools";

describe("formatPracticeProfile", () => {
  it("returns an empty string when there is no profile", () => {
    expect(formatPracticeProfile(null)).toBe("");
    expect(formatPracticeProfile(undefined)).toBe("");
    expect(formatPracticeProfile("   ")).toBe("");
  });

  it("wraps the profile in a labelled, authoritative system block", () => {
    const out = formatPracticeProfile("We cap liability at 12 months of fees.");
    expect(out).toContain("USER PRACTICE PROFILE:");
    expect(out).toContain("authoritative");
    // The verbatim profile text is preserved.
    expect(out).toContain("We cap liability at 12 months of fees.");
    // Tells the model to ask rather than invent missing values.
    expect(out).toMatch(/ask the user/i);
  });
});

describe("buildPracticeProfileBlock", () => {
  it("injects only the general profile when no area matches", async () => {
    const { buildPracticeProfileBlock } = await import(
      "../../src/lib/chatTools"
    );
    const out = buildPracticeProfileBlock(
      { general: "Firm-wide rules.", byArea: { Litigation: "Lit rules." } },
      null,
    );
    expect(out).toContain("USER PRACTICE PROFILE:");
    expect(out).toContain("Firm-wide rules.");
    expect(out).not.toContain("Lit rules.");
  });

  it("appends the active area's profile, labelled, alongside the general one", async () => {
    const { buildPracticeProfileBlock } = await import(
      "../../src/lib/chatTools"
    );
    const out = buildPracticeProfileBlock(
      { general: "Firm-wide rules.", byArea: { Litigation: "Lit rules." } },
      "Litigation",
    );
    expect(out).toContain("USER PRACTICE PROFILE:");
    expect(out).toContain("USER PRACTICE PROFILE — Litigation:");
    expect(out).toContain("Firm-wide rules.");
    expect(out).toContain("Lit rules.");
  });

  it("returns empty when nothing is configured", async () => {
    const { buildPracticeProfileBlock } = await import(
      "../../src/lib/chatTools"
    );
    expect(buildPracticeProfileBlock({ general: null, byArea: {} }, "Litigation")).toBe(
      "",
    );
  });
});

describe("getUserPracticeProfiles", () => {
  it("returns the general profile and a cleaned per-area map", async () => {
    const mod = await import("../../src/lib/userSettings");
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                practice_profile: "  general  ",
                practice_profiles: {
                  Litigation: "lit",
                  Employment: "   ", // blank -> dropped
                },
              },
              error: null,
            }),
          }),
        }),
      }),
    } as never;
    const profiles = await mod.getUserPracticeProfiles("u", db);
    expect(profiles.general).toBe("  general  ");
    expect(profiles.byArea).toEqual({ Litigation: "lit" });
  });
});
