import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeSupabase, type FakeDb } from "../../lib/dms/__tests__/fakeDb";
import { fakeEnv } from "../../lib/dms/__tests__/fakeEnv";

// The whole app graph reaches lib/env; stub it with network-free defaults.
vi.mock("../../lib/env", () => ({ env: fakeEnv }));

// One shared stateful fake DB instance so writes made in a request are visible
// to later reads/requests (createServerSupabase is called per handler).
let db: FakeDb;
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => db),
    getAdminClient: vi.fn(() => db),
}));

// Authenticated as u1 for every request (mirrors the other route tests).
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

// Never touch real object storage.
vi.mock("../../lib/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/storage")>();
    return {
        ...actual,
        uploadFile: vi.fn(async () => {}),
        downloadFile: vi.fn(async () => new ArrayBuffer(8)),
    };
});

import { app } from "../../app";
import { sharedFakeDms } from "../../lib/dms";

function seedDb(): FakeDb {
    return createFakeSupabase({
        dms_connectors: [],
        dms_connector_oauth_tokens: [],
        dms_document_links: [],
        documents: [],
        document_versions: [],
        projects: [
            {
                id: "proj-1",
                user_id: "u1",
                shared_with: [],
                org_id: "org-1",
            },
            {
                id: "proj-other",
                user_id: "someone-else",
                shared_with: [],
                org_id: null,
            },
        ],
    });
}

beforeEach(() => {
    db = seedDb();
    sharedFakeDms.reset();
    sharedFakeDms.seedDocument({
        id: "dms-doc-1",
        name: "Imported.pdf",
        extension: "pdf",
        contentType: "application/pdf",
        content: "%PDF fake body",
    });
});

describe("DMS connector routes", () => {
    it("creates a Fake connector via POST /user/dms-connectors", async () => {
        const res = await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "fake", name: "Test DMS", baseUrl: "https://fake.invalid" });
        expect(res.status).toBe(201);
        expect(res.body.kind).toBe("fake");
        expect(db._tables.dms_connectors).toHaveLength(1);
    });

    it("rejects an unknown connector kind with 400", async () => {
        const res = await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "bogus", name: "x", baseUrl: "https://x" });
        expect(res.status).toBe(400);
    });

    it("imports a Fake document into a project the user can access", async () => {
        const create = await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "fake", name: "Test DMS", baseUrl: "https://fake.invalid" });
        const connectorId = create.body.id as string;

        const res = await request(app)
            .post(`/user/dms-connectors/${connectorId}/import`)
            .set("Authorization", "Bearer test")
            .send({ dmsDocId: "dms-doc-1", projectId: "proj-1" });

        expect(res.status).toBe(201);
        expect(res.body.documentId).toBeTruthy();

        // A documents row + a V1 document_versions row (source 'dms_import').
        expect(db._tables.documents).toHaveLength(1);
        const versions = db._tables.document_versions;
        expect(versions).toHaveLength(1);
        expect(versions[0].source).toBe("dms_import");
        expect(versions[0].version_number).toBe(1);
        // The external mapping was recorded for round-trip export.
        expect(db._tables.dms_document_links).toHaveLength(1);
        expect(db._tables.dms_document_links[0].dms_doc_id).toBe("dms-doc-1");
    });

    it("returns 400 when dmsDocId is missing", async () => {
        const create = await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "fake", name: "Test DMS", baseUrl: "https://fake.invalid" });
        const res = await request(app)
            .post(`/user/dms-connectors/${create.body.id}/import`)
            .set("Authorization", "Bearer test")
            .send({ projectId: "proj-1" });
        expect(res.status).toBe(400);
    });

    it("refuses import into a project the user cannot access with 404", async () => {
        const create = await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "fake", name: "Test DMS", baseUrl: "https://fake.invalid" });
        const res = await request(app)
            .post(`/user/dms-connectors/${create.body.id}/import`)
            .set("Authorization", "Bearer test")
            .send({ dmsDocId: "dms-doc-1", projectId: "proj-other" });
        expect(res.status).toBe(404);
        expect(db._tables.documents).toHaveLength(0);
    });

    it("lists connectors for the user", async () => {
        await request(app)
            .post("/user/dms-connectors")
            .set("Authorization", "Bearer test")
            .send({ kind: "fake", name: "One", baseUrl: "https://fake.invalid" });
        const res = await request(app)
            .get("/user/dms-connectors")
            .set("Authorization", "Bearer test");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(1);
    });
});
