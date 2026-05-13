import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @supabase/supabase-js before importing the module under test
vi.mock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => ({
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: { id: "real-user-id" } } }),
        },
    })),
}));

describe("getUserIdFromRequest", () => {
    beforeEach(() => {
        vi.resetModules();
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.SUPABASE_SECRET_KEY;
    });

    it("throws 500 when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
        process.env.SUPABASE_SECRET_KEY = "some-secret";
        const { getUserIdFromRequest } = await import("../supabase-server");
        const req = new Request("http://localhost", {
            headers: { authorization: "Bearer any-uuid-here" },
        });
        await expect(getUserIdFromRequest(req)).rejects.toBeInstanceOf(Response);
        const err = await getUserIdFromRequest(req).catch((r: Response) => r);
        expect((err as Response).status).toBe(500);
    });

    it("throws 500 when SUPABASE_SECRET_KEY is missing", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
        const { getUserIdFromRequest } = await import("../supabase-server");
        const req = new Request("http://localhost", {
            headers: { authorization: "Bearer any-uuid-here" },
        });
        const err = await getUserIdFromRequest(req).catch((r: Response) => r);
        expect((err as Response).status).toBe(500);
    });

    it("throws 500 when both env vars are missing", async () => {
        const { getUserIdFromRequest } = await import("../supabase-server");
        const req = new Request("http://localhost", {
            headers: { authorization: "Bearer any-uuid-here" },
        });
        const err = await getUserIdFromRequest(req).catch((r: Response) => r);
        expect((err as Response).status).toBe(500);
    });

    it("throws 401 when Authorization header is missing", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
        process.env.SUPABASE_SECRET_KEY = "service-key";
        const { getUserIdFromRequest } = await import("../supabase-server");
        const req = new Request("http://localhost");
        const err = await getUserIdFromRequest(req).catch((r: Response) => r);
        expect((err as Response).status).toBe(401);
    });
});
