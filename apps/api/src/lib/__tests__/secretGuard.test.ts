import { describe, expect, it } from "vitest";
import { assertSecretsHardened } from "../secretGuard";

const DEMO_JWT = "super-secret-jwt-token-with-at-least-32-characters-long";
// A real Supabase demo anon key (iss = "supabase-demo").
const DEMO_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const GOOD = {
    JWT_SECRET: "x".repeat(48),
    SUPABASE_SECRET_KEY: "a.b.c", // non-demo, unparseable issuer is fine
    USER_API_KEYS_ENCRYPTION_SECRET: "k".repeat(40),
    DOWNLOAD_SIGNING_SECRET: "s".repeat(40),
};

describe("assertSecretsHardened", () => {
    it("is a no-op when not air-gapped / not production", () => {
        expect(() => assertSecretsHardened({ JWT_SECRET: DEMO_JWT })).not.toThrow();
    });

    it("rejects the demo JWT secret in air-gapped mode", () => {
        expect(() =>
            assertSecretsHardened({ ...GOOD, AIRGAPPED: "true", JWT_SECRET: DEMO_JWT }),
        ).toThrow(/demo secret/i);
    });

    it("rejects a Supabase demo key (iss supabase-demo) in production", () => {
        expect(() =>
            assertSecretsHardened({
                ...GOOD,
                NODE_ENV: "production",
                SERVICE_ROLE_KEY: DEMO_ANON,
            }),
        ).toThrow(/demo key/i);
    });

    it("rejects placeholder / short encryption secrets", () => {
        expect(() =>
            assertSecretsHardened({
                ...GOOD,
                AIRGAPPED: "true",
                // >=32 chars so it clears the length check and hits the placeholder check.
                USER_API_KEYS_ENCRYPTION_SECRET: "your-long-random-secret-change-me-now",
            }),
        ).toThrow(/placeholder/i);
        expect(() =>
            assertSecretsHardened({
                ...GOOD,
                AIRGAPPED: "true",
                DOWNLOAD_SIGNING_SECRET: "tooshort",
            }),
        ).toThrow(/32 chars/i);
    });

    it("passes with strong, non-demo secrets in air-gapped mode", () => {
        expect(() =>
            assertSecretsHardened({ ...GOOD, AIRGAPPED: "true" }),
        ).not.toThrow();
    });

    it("reports every problem at once", () => {
        try {
            assertSecretsHardened({
                AIRGAPPED: "true",
                JWT_SECRET: DEMO_JWT,
                SERVICE_ROLE_KEY: DEMO_ANON,
                USER_API_KEYS_ENCRYPTION_SECRET: "short",
                DOWNLOAD_SIGNING_SECRET: "short",
            });
            throw new Error("should have thrown");
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toMatch(/demo secret/i);
            expect(msg).toMatch(/demo key/i);
            expect(msg).toMatch(/USER_API_KEYS_ENCRYPTION_SECRET/);
        }
    });
});
