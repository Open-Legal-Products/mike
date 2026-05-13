import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoist mock so it applies before module imports
vi.mock("../supabase.js", () => ({
    createServerSupabase: vi.fn(() => ({
        from: vi.fn(() => ({
            upsert: vi.fn().mockResolvedValue({ error: null }),
        })),
    })),
}));

describe("saveUserApiKey — encryption key configuration", () => {
    beforeEach(() => {
        vi.resetModules();
        delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
        delete process.env.API_KEYS_ENCRYPTION_SECRET;
        delete process.env.SUPABASE_SECRET_KEY;
    });

    it("throws when no encryption secret is configured", async () => {
        const { saveUserApiKey } = await import("../userApiKeys.js");
        await expect(saveUserApiKey("user-id", "claude", "sk-test")).rejects.toThrow("API key encryption secret is not configured");
    });

    it("throws when only SUPABASE_SECRET_KEY is set (fallback removed)", async () => {
        process.env.SUPABASE_SECRET_KEY = "supabase-service-key";
        const { saveUserApiKey } = await import("../userApiKeys.js");
        await expect(saveUserApiKey("user-id", "claude", "sk-test")).rejects.toThrow("API key encryption secret is not configured");
    });

    it("succeeds when USER_API_KEYS_ENCRYPTION_SECRET is set", async () => {
        process.env.USER_API_KEYS_ENCRYPTION_SECRET = "dedicated-encryption-secret-32bytes";
        const { saveUserApiKey } = await import("../userApiKeys.js");
        await expect(saveUserApiKey("user-id", "claude", "sk-test")).resolves.not.toThrow();
    });
});
