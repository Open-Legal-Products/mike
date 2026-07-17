import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  applyTrackedEdits,
  extractDocxBodyText,
  extractDocxRedlines,
  formatRedlineSummary,
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

describe("extractDocxRedlines", () => {
  it("returns nothing for a document with no tracked changes", async () => {
    const bytes = await makeDocx(SENTENCE);
    expect(await extractDocxRedlines(bytes)).toEqual([]);
  });

  it("recovers the inserted and deleted text of a pre-existing tracked change", async () => {
    const original = await makeDocx(SENTENCE);
    const { bytes: redlined } = await applyTrackedEdits(
      original,
      [
        {
          find: "quick brown fox",
          replace: "swift red hawk",
          context_before: "The ",
          context_after: " jumps",
        },
      ],
      { author: "Opposing Counsel" },
    );

    const redlines = await extractDocxRedlines(redlined);
    expect(redlines).toHaveLength(2);
    const ins = redlines.find((r) => r.kind === "ins");
    const del = redlines.find((r) => r.kind === "del");
    expect(ins?.text).toBe("swift red hawk");
    expect(ins?.author).toBe("Opposing Counsel");
    expect(del?.text).toBe("quick brown fox");
    expect(del?.author).toBe("Opposing Counsel");
  });

  it("extracts redlines from a document that accepted-view flattening would render unchanged", async () => {
    // The reader-facing extractors (extractDocxBodyText / extractDocxMarkdown)
    // deliberately present an "accepted view" of this same document: the
    // insertion reads as plain text and the deletion is invisible. Confirm
    // extractDocxRedlines recovers what that view throws away.
    const original = await makeDocx(SENTENCE);
    const { bytes: redlined } = await applyTrackedEdits(
      original,
      [
        {
          find: "lazy dog",
          replace: "diligent cat",
          context_before: "over the ",
          context_after: ".",
        },
      ],
      { author: "Opposing Counsel" },
    );

    const acceptedView = await extractDocxBodyText(redlined);
    expect(acceptedView).toContain("diligent cat");
    expect(acceptedView).not.toContain("lazy dog");

    const redlines = await extractDocxRedlines(redlined);
    const del = redlines.find((r) => r.kind === "del");
    expect(del?.text).toBe("lazy dog");
  });
});

describe("formatRedlineSummary", () => {
  it("returns an empty string when there are no entries", () => {
    expect(formatRedlineSummary([])).toBe("");
  });

  it("renders each entry with its verb, author, and quoted text", () => {
    const summary = formatRedlineSummary([
      { kind: "ins", author: "Opposing Counsel", text: "swift red hawk" },
      { kind: "del", author: "Opposing Counsel", text: "quick brown fox" },
    ]);
    expect(summary).toContain("Existing tracked changes");
    expect(summary).toContain('Inserted by Opposing Counsel: "swift red hawk"');
    expect(summary).toContain('Deleted by Opposing Counsel: "quick brown fox"');
  });

  it("truncates and notes omitted entries beyond the cap", () => {
    const entries = Array.from({ length: 205 }, (_, i) => ({
      kind: "ins" as const,
      text: `change ${i}`,
    }));
    const summary = formatRedlineSummary(entries);
    expect(summary).toContain("and 5 more tracked change(s), omitted for length");
  });
});
