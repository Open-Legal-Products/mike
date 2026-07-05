import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// Capture the bytes handed to storage so we can inspect the generated .docx.
const hoisted = vi.hoisted(() => {
  const captured: { buf?: ArrayBuffer } = {};
  return { captured };
});

vi.mock("../storage", () => ({
  generatedDocKey: (userId: string, docId: string, filename: string) =>
    `generated/${userId}/${docId}/${filename}`,
  uploadFile: vi.fn(async (_key: string, buf: ArrayBuffer) => {
    hoisted.captured.buf = buf;
  }),
}));

vi.mock("../downloadTokens", () => ({
  buildDownloadUrl: (key: string, filename: string) =>
    `https://dl.test/${encodeURIComponent(filename)}?k=${encodeURIComponent(key)}`,
}));

// createServerSupabase is only referenced as a type in docxGenerate; stub the
// module so importing it never touches real env/config.
vi.mock("../supabase", () => ({
  createServerSupabase: () => ({}),
}));

import { generateDocx } from "./docxGenerate";

/** Minimal chainable stub of the Supabase client used by generateDocx. */
function fakeDb() {
  return {
    from(table: string) {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: table === "documents" ? "doc-1" : "ver-1" },
              error: null,
            }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

async function documentXml(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const part = zip.file("word/document.xml");
  if (!part) throw new Error("word/document.xml missing from generated docx");
  return part.async("string");
}

describe("generateDocx", () => {
  beforeEach(() => {
    hoisted.captured.buf = undefined;
  });

  it("produces a valid .docx whose bytes contain the title, prose, and table cells", async () => {
    const sections = [
      { heading: "Overview", content: "The widget agreement covers everything." },
      {
        heading: "Schedule",
        table: { headers: ["Index", "Clause"], rows: [["1", "alpha"], ["2", "beta"]] },
      },
    ];

    const result = (await generateDocx(
      "My Title",
      sections,
      "user-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeDb() as any,
      {},
    )) as Record<string, unknown>;

    // Success shape (no error branch taken)
    expect(result.error).toBeUndefined();
    expect(result.filename).toBe("My Title.docx");
    expect(result.document_id).toBe("doc-1");
    expect(result.version_id).toBe("ver-1");
    expect(result.version_number).toBe(1);
    expect(String(result.download_url)).toContain("My%20Title.docx");

    // The real bytes were uploaded and are a valid docx package with our content.
    expect(hoisted.captured.buf).toBeDefined();
    const xml = await documentXml(hoisted.captured.buf!);
    expect(xml).toContain("MY TITLE"); // title is upper-cased
    expect(xml).toContain("widget"); // body prose
    expect(xml).toContain("alpha"); // table cell
    expect(xml).toContain("beta"); // second table row
  });

  it("honours the landscape option and still emits a valid package", async () => {
    const result = (await generateDocx(
      "Landscape Doc",
      [{ heading: "Section", content: "Body text here." }],
      "user-2",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeDb() as any,
      { landscape: true },
    )) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.filename).toBe("Landscape Doc.docx");
    const xml = await documentXml(hoisted.captured.buf!);
    // Landscape orientation is recorded in the section properties.
    expect(xml.toLowerCase()).toContain("landscape");
    expect(xml).toContain("Body text here.");
  });

  it("sanitizes an unsafe title into a filesystem-safe filename", async () => {
    const result = (await generateDocx(
      "Re: Smith v. Jones / Draft #1",
      [{ content: "x" }],
      "user-3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeDb() as any,
    )) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    // Non [a-zA-Z0-9 -] chars are stripped; extension re-appended.
    expect(result.filename).toBe("Re Smith v Jones  Draft 1.docx");
  });
});
