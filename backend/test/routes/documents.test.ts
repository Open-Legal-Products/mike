import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  createSupabaseMock,
  type SupabaseMockControl,
} from "../helpers/supabaseMock";

const auth = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  userEmail: "user@example.com",
}));
const sb = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/lib/supabase", () => ({
  createServerSupabase: () => sb.current,
}));
vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (req: unknown, res: any, next: () => void) => {
    if (!auth.userId)
      return void res.status(401).json({ detail: "unauthorized" });
    res.locals.userId = auth.userId;
    res.locals.userEmail = auth.userEmail;
    res.locals.token = "test-token";
    next();
  },
}));
vi.mock("../../src/lib/storage", () => ({
  uploadFile: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => new TextEncoder().encode("bytes").buffer),
  deleteFile: vi.fn(async () => {}),
  getSignedUrl: vi.fn(async () => "https://signed.example/x"),
  buildContentDisposition: (type: string, filename: string) =>
    `${type}; filename="${filename}"`,
  storageKey: (...p: string[]) => `key/${p.join("/")}`,
  versionStorageKey: (...p: string[]) => `vkey/${p.join("/")}`,
}));
vi.mock("../../src/lib/convert", () => ({
  docxToPdf: vi.fn(async () => Buffer.from("pdf-bytes")),
  convertedPdfKey: (userId: string, docId: string) => `pdf/${userId}/${docId}`,
}));
vi.mock("../../src/lib/documentVersions", () => ({
  attachLatestVersionNumbers: vi.fn(async () => {}),
  attachActiveVersionPaths: vi.fn(async () => {}),
  loadActiveVersion: vi.fn(async () => null),
}));

import { createApp } from "../../src/index";

let app: ReturnType<typeof createApp>;
let mock: SupabaseMockControl;

beforeEach(() => {
  auth.userId = "user-1";
  mock = createSupabaseMock();
  sb.current = mock.db;
  app = createApp();
});

describe("auth gate", () => {
  it("returns 401 without auth", async () => {
    auth.userId = null;
    expect((await request(app).get("/single-documents")).status).toBe(401);
  });
});

describe("GET /single-documents", () => {
  it("lists the user's standalone documents", async () => {
    mock.queue({ data: [], error: null });
    const res = await request(app).get("/single-documents");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 on query error", async () => {
    mock.queue({ data: null, error: { message: "boom" } });
    const res = await request(app).get("/single-documents");
    expect(res.status).toBe(500);
  });
});

describe("DELETE /single-documents/:documentId", () => {
  it("returns 404 when the document is missing", async () => {
    mock.queue({ data: null, error: null });
    expect((await request(app).delete("/single-documents/d1")).status).toBe(
      404,
    );
  });

  it("deletes the document and its version bytes", async () => {
    mock.queueMany([
      { data: { id: "d1" }, error: null }, // doc lookup
      {
        data: [{ storage_path: "a", pdf_storage_path: "b" }],
        error: null,
      }, // versions
      // documents.delete -> default
    ]);
    const res = await request(app).delete("/single-documents/d1");
    expect(res.status).toBe(204);
  });
});

describe("GET /single-documents/:documentId/display", () => {
  it("returns 404 when the document is not found", async () => {
    mock.queue({ data: null, error: null });
    const res = await request(app).get("/single-documents/d1/display");
    expect(res.status).toBe(404);
  });
});

describe("POST /single-documents (upload)", () => {
  it("rejects a request with no file", async () => {
    const res = await request(app).post("/single-documents");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: "file is required" });
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app)
      .post("/single-documents")
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Unsupported file type/);
  });

  it("uploads a docx and returns the created document", async () => {
    mock.queueMany([
      { data: { id: "d1" }, error: null }, // insert documents
      { data: { id: "v1" }, error: null }, // insert document_versions
      { data: null, error: null }, // update documents
      { data: { id: "d1", filename: "contract.docx" }, error: null }, // re-select
    ]);
    const res = await request(app)
      .post("/single-documents")
      .attach("file", Buffer.from("PKdocxbytes"), {
        filename: "contract.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "d1", filename: "contract.docx" });
  });
});
