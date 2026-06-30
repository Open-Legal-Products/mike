import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// Mock env so the app factory can build its rate limiters in tests.
vi.mock("../../lib/env", () => ({
    env: {
        NODE_ENV: "test",
        FRONTEND_URL: "http://localhost:3000",
        TRUST_PROXY_HOPS: 1,
        RATE_LIMIT_GENERAL_WINDOW_MINUTES: 15,
        RATE_LIMIT_GENERAL_MAX: 300,
        RATE_LIMIT_CHAT_WINDOW_MINUTES: 15,
        RATE_LIMIT_CHAT_MAX: 100,
        RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES: 15,
        RATE_LIMIT_CHAT_CREATE_MAX: 60,
        RATE_LIMIT_UPLOAD_WINDOW_HOURS: 1,
        RATE_LIMIT_UPLOAD_MAX: 100,
        R2_BUCKET_NAME: "mike",
        ASYNC_DOCUMENT_CONVERSION: "false",
    },
}));

function mockSupabase() {
    const result = { data: null, error: null };
    const q: Record<string, unknown> = {};
    const chain = [
        "select", "insert", "update", "delete", "upsert",
        "eq", "neq", "in", "is", "or", "lt", "order", "limit",
    ];
    for (const m of chain) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
    return {
        from: vi.fn(() => q),
        rpc: vi.fn(() => Promise.resolve(result)),
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
        },
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => mockSupabase()),
    getAdminClient: vi.fn(() => mockSupabase()),
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

// Stub the storage IO functions so a successful upload would never touch R2,
// while keeping the rest of the storage module (e.g. checkStorageReady, used by
// the app's /ready route) real. The validation tests below reject before
// storage is reached, but this guards against accidental real IO regardless.
vi.mock("../../lib/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/storage")>();
    return {
        ...actual,
        uploadFile: vi.fn(async () => {}),
        downloadFile: vi.fn(async () => null),
        deleteFile: vi.fn(async () => {}),
    };
});

import { app } from "../../app";

// Minimal valid magic bytes for each type (see lib/upload.ts MAGIC_SIGNATURES).
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

describe("POST /single-documents — upload validation", () => {
    it("rejects an unsupported file extension with 400", async () => {
        const res = await request(app)
            .post("/single-documents")
            .set("Authorization", "Bearer test")
            .attach("file", Buffer.from("hello world"), {
                filename: "notes.txt",
                contentType: "text/plain",
            });

        expect(res.status).toBe(400);
        expect(res.body.detail).toMatch(/unsupported file type/i);
    });

    it("rejects a file whose magic bytes don't match its extension with 400", async () => {
        // .pdf extension but plain-text content — fails the magic-byte check.
        const res = await request(app)
            .post("/single-documents")
            .set("Authorization", "Bearer test")
            .attach("file", Buffer.from("this is not really a pdf"), {
                filename: "fake.pdf",
                contentType: "application/pdf",
            });

        expect(res.status).toBe(400);
        expect(res.body.detail).toMatch(/does not match its extension/i);
    });

    it("passes the magic-byte gate for content matching the extension", async () => {
        // A real %PDF header clears validation; downstream storage/DB are
        // mocked, so we only assert the request was NOT rejected at the gate.
        const res = await request(app)
            .post("/single-documents")
            .set("Authorization", "Bearer test")
            .attach("file", Buffer.concat([PDF_MAGIC, Buffer.from(" rest")]), {
                filename: "real.pdf",
                contentType: "application/pdf",
            });

        expect(res.status).not.toBe(400);
    });
});

describe("POST /single-documents/download-zip — bounds", () => {
    it("returns 400 when document_ids is empty", async () => {
        const res = await request(app)
            .post("/single-documents/download-zip")
            .set("Authorization", "Bearer test")
            .send({ document_ids: [] });

        expect(res.status).toBe(400);
        expect(res.body.detail).toMatch(/document_ids is required/i);
    });

    it("returns 400 when document_ids exceeds the 50-document cap", async () => {
        const tooMany = Array.from({ length: 51 }, (_, i) => `doc-${i}`);
        const res = await request(app)
            .post("/single-documents/download-zip")
            .set("Authorization", "Bearer test")
            .send({ document_ids: tooMany });

        expect(res.status).toBe(400);
        expect(res.body.detail).toMatch(/more than 50/i);
    });
});
