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

describe("getUserPracticeProfile", () => {
  it("returns the trimmed profile, or null when blank/absent", async () => {
    // Import lazily so we can stub createServerSupabase per-case.
    const mod = await import("../../src/lib/userSettings");
    const make = (practice_profile: unknown) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: practice_profile === undefined
                  ? null
                  : { practice_profile },
                error: null,
              }),
            }),
          }),
        }),
      }) as never;

    expect(await mod.getUserPracticeProfile("u", make("  keep me  "))).toBe(
      "  keep me  ",
    );
    expect(await mod.getUserPracticeProfile("u", make("   "))).toBeNull();
    expect(await mod.getUserPracticeProfile("u", make(undefined))).toBeNull();
  });
});
