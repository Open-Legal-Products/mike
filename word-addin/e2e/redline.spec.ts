import { expect, test } from "@playwright/test";
import { projectRedlineStream } from "../src/taskpane/lib/redline";

test.describe("streaming tagged redline projection", () => {
  test("hides a tag from its first partial chunk", () => {
    const projection = projectRedlineStream("Summary before edit.\n\n<ori");

    expect(projection.visibleProse).toBe("Summary before edit.");
    expect(projection.protocolStarted).toBe(true);
    expect(projection.edits).toEqual([]);
    expect(projection.safeEdits).toEqual([]);
  });

  test("exposes a provisional card while tagged fields stream", () => {
    const projection = projectRedlineStream(
      "<original>The Suplier</original><replacement>The Supp"
    );

    expect(projection.visibleProse).toBe("");
    expect(projection.edits).toEqual([
      {
        blockIndex: 0,
        original: "The Suplier",
        replacement: "The Supp",
        sealed: false,
      },
    ]);
    expect(projection.safeEdits).toEqual([]);
  });

  test("seals a complete tagged block as soon as reason closes", () => {
    const text =
      "<original>The Suplier</original>\n" +
      "<replacement>The Supplier</replacement>\n" +
      "<reason>Typo.</reason>\n\n" +
      "I corrected the supplier name.";
    const projection = projectRedlineStream(text);

    expect(projection.visibleProse).toBe("I corrected the supplier name.");
    expect(projection.edits).toEqual([
      {
        blockIndex: 0,
        original: "The Suplier",
        replacement: "The Supplier",
        reason: "Typo.",
        sealed: true,
      },
    ]);
    expect(projection.safeEdits).toEqual([
      {
        original: "The Suplier",
        replacement: "The Supplier",
        reason: "Typo.",
      },
    ]);
  });

  test("keeps an incomplete tagged block unsafe after stream completion", () => {
    const projection = projectRedlineStream(
      "<original>shall deliver goods</original>" +
        "<replacement>shall deliver the goods</replacement>" +
        "<reason>Missing article.",
      true
    );

    expect(projection.edits[0]).toMatchObject({
      original: "shall deliver goods",
      replacement: "shall deliver the goods",
      reason: "Missing article.",
      sealed: false,
    });
    expect(projection.safeEdits).toEqual([]);
  });

  test("seals earlier blocks while leaving the active block provisional", () => {
    const projection = projectRedlineStream(
      "<original>first</original><replacement>First</replacement>" +
        "<reason>Capitalise.</reason>" +
        "<original>second</original><replacement>Sec"
    );

    expect(projection.edits).toEqual([
      {
        blockIndex: 0,
        original: "first",
        replacement: "First",
        reason: "Capitalise.",
        sealed: true,
      },
      {
        blockIndex: 1,
        original: "second",
        replacement: "Sec",
        sealed: false,
      },
    ]);
  });

  test("completed projection returns prose and safe edits together", () => {
    const text =
      "<original>The Suplier</original><replacement>The Supplier</replacement>" +
      "<reason>Typo.</reason>" +
      "<original>goods</original><replacement>the goods</replacement>" +
      "<reason>Missing article.</reason>\nSummary.";
    const projection = projectRedlineStream(text, true);

    expect(projection.visibleProse).toBe("Summary.");
    expect(projection.safeEdits).toEqual([
      {
        original: "The Suplier",
        replacement: "The Supplier",
        reason: "Typo.",
      },
      {
        original: "goods",
        replacement: "the goods",
        reason: "Missing article.",
      },
    ]);
  });

  test("keeps raw block ordinals stable when a duplicate edit is omitted", () => {
    const block = (original: string, replacement: string) =>
      `<original>${original}</original><replacement>${replacement}</replacement>` +
      "<reason>Reason.</reason>";
    const projection = projectRedlineStream(
      block("duplicate", "first") +
        block("duplicate", "second") +
        block("distinct", "changed")
    );

    expect(projection.edits.map((edit) => edit.blockIndex)).toEqual([0, 2]);
    expect(projection.safeEdits).toEqual([
      { original: "duplicate", replacement: "first", reason: "Reason." },
      { original: "distinct", replacement: "changed", reason: "Reason." },
    ]);
  });

  test("still reads legacy label blocks from previously saved chats", () => {
    const legacy =
      "ORIGINAL: old text\nREPLACEMENT: new text\nREASON: Legacy chat.";
    expect(projectRedlineStream(legacy, true).safeEdits).toEqual([
      {
        original: "old text",
        replacement: "new text",
        reason: "Legacy chat.",
      },
    ]);
  });
});
