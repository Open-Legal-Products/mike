import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  applyTrackedEdits,
  extractDocxBodyText,
} from "./docxTrackedChanges";

/** Build a one-paragraph .docx with the given text, as a Node Buffer. */
async function makeDocx(text: string): Promise<Buffer> {
  const { Document, Paragraph, TextRun, Packer } = await import("docx");
  const doc = new Document({
    sections: [
      { children: [new Paragraph({ children: [new TextRun(text)] })] },
    ],
  });
  return Packer.toBuffer(doc);
}

async function documentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("word/document.xml")!.async("string");
}

const SENTENCE = "The quick brown fox jumps over the lazy dog.";

describe("extractDocxBodyText", () => {
  it("returns the paragraph text from a docx", async () => {
    const bytes = await makeDocx(SENTENCE);
    const text = await extractDocxBodyText(bytes);
    expect(text).toContain("quick brown fox");
    expect(text).toContain("lazy dog");
  });
});

describe("applyTrackedEdits", () => {
  it("records a find/replace as a tracked change and keeps both texts in the markup", async () => {
    const bytes = await makeDocx(SENTENCE);
    const result = await applyTrackedEdits(
      bytes,
      [
        {
          find: "quick brown fox",
          replace: "swift red hawk",
          context_before: "The ",
          context_after: " jumps",
        },
      ],
      { author: "Tester" },
    );

    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].deletedText).toBe("quick brown fox");
    expect(result.changes[0].insertedText).toBe("swift red hawk");

    // Output is a valid docx whose markup carries the tracked change: an
    // inserted run with the new text and a deleted run with the old text.
    const xml = await documentXml(result.bytes);
    expect(xml).toContain("<w:ins");
    expect(xml).toContain("<w:del");
    expect(xml).toContain("swift red hawk");
    expect(xml).toContain("quick brown fox");
    expect(xml).toContain('w:author="Tester"');
  });

  it("reports an error and applies nothing when the target text is not found", async () => {
    const bytes = await makeDocx(SENTENCE);
    const result = await applyTrackedEdits(bytes, [
      {
        find: "nonexistent phrase",
        replace: "whatever",
        context_before: "",
        context_after: "",
      },
    ]);

    expect(result.changes).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(0);
  });
});
