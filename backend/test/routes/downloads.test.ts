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
// Only the network-touching storage helper is mocked; buildContentDisposition
// keeps a faithful-enough implementation so the header assertion is meaningful.
vi.mock("../../src/lib/storage", () => ({
  downloadFile: vi.fn(async () => new TextEncoder().encode("PKfilebytes").buffer),
  buildContentDisposition: (type: string, filename: string) =>
    `${type}; filename="${filename}"`,
}));

import { createApp } from "../../src/index";
// Real signer/verifier — exercises the token round-trip against the test secret.
import { signDownload } from "../../src/lib/downloadTokens";
import { downloadFile } from "../../src/lib/storage";

let app: ReturnType<typeof createApp>;
let mock: SupabaseMockControl;

beforeEach(() => {
  auth.userId = "user-1";
  mock = createSupabaseMock();
  sb.current = mock.db;
  app = createApp();
});

describe("GET /download/:token", () => {
  it("returns 401 without auth", async () => {
    auth.userId = null;
    const token = signDownload("docs/file.docx", "file.docx");
    expect((await request(app).get(`/download/${token}`)).status).toBe(401);
  });

  it("returns 404 for an invalid token", async () => {
    const res = await request(app).get("/download/not-a-valid-token");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Invalid link" });
  });

  it("returns 404 when the caller lacks access", async () => {
    mock.queueMany([
      { data: { id: "v1", document_id: "d1" }, error: null },
      // Document owned by someone else, no project -> ensureDocAccess fails.
      { data: { id: "d1", user_id: "other", project_id: null }, error: null },
    ]);
    const token = signDownload("docs/file.docx", "file.docx");
    const res = await request(app).get(`/download/${token}`);
    expect(res.status).toBe(404);
  });

  it("streams the file with the right content type for the owner", async () => {
    mock.queueMany([
      { data: { id: "v1", document_id: "d1" }, error: null },
      { data: { id: "d1", user_id: "user-1", project_id: null }, error: null },
    ]);
    const token = signDownload("docs/file.docx", "file.docx");
    const res = await request(app).get(`/download/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="file.docx"',
    );
    expect(downloadFile).toHaveBeenCalledWith("docs/file.docx");
  });

  it("maps .pdf to the pdf content type", async () => {
    mock.queueMany([
      { data: { id: "v1", document_id: "d1" }, error: null },
      { data: { id: "d1", user_id: "user-1", project_id: null }, error: null },
    ]);
    const token = signDownload("docs/file.pdf", "file.pdf");
    const res = await request(app).get(`/download/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });
});
