import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// The security property: the guest endpoint MUST refuse in production, before it
// ever touches Supabase (a well-known guest credential must never exist on a
// hosted deployment).
vi.mock("../../../lib/env", () => ({
    env: { NODE_ENV: "production", SUPABASE_URL: "http://x", SUPABASE_SECRET_KEY: "x" },
}));
vi.mock("../../../lib/supabase", () => ({
    getAdminClient: () => {
        throw new Error("must NOT touch Supabase in production");
    },
}));

import { guestRouter } from "../auth.routes";

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/auth", guestRouter);
    return app;
}

describe("POST /auth/guest", () => {
    it("is hard-gated off in production (403, no Supabase call)", async () => {
        const res = await request(makeApp()).post("/auth/guest");
        expect(res.status).toBe(403);
        expect(res.body.detail).toMatch(/disabled in production/i);
    });
});
