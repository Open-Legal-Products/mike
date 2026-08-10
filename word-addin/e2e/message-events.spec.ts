import { expect, test } from "@playwright/test";
import {
  assistantContent,
  assistantDocumentReads,
  assistantError,
  appendAssistantReasoning,
  completeAssistantEvents,
  finishAssistantReasoning,
  messageFromStorage,
  appendAssistantContent,
  normalizeStoredAssistantEvents,
  upsertDocumentReadEvent,
} from "../src/taskpane/lib/wordChatEvents";
import type { WordAssistantEvent } from "../src/taskpane/types";

test.describe("Word assistant message events", () => {
  test("adapts stored assistant messages into ordered render events", () => {
    const message = messageFromStorage(
      {
        id: "assistant-1",
        role: "assistant",
        content: "Summary",
        docReads: [
          {
            filename: "Agreement.docx",
            documentId: "document-1",
            status: "read",
          },
        ],
      },
      "fallback",
    );
    if (message.role !== "assistant") {
      throw new Error("Expected an assistant message.");
    }

    expect(assistantDocumentReads(message)).toEqual([
      {
        filename: "Agreement.docx",
        documentId: "document-1",
        status: "read",
      },
    ]);
    expect(assistantContent(message)).toBe("Summary");
  });

  test("keeps distinct document IDs and never downgrades Read to Reading", () => {
    let events: WordAssistantEvent[] = [];
    events = upsertDocumentReadEvent(events, {
      filename: "Agreement.docx",
      documentId: "document-1",
      status: "reading",
    });
    events = upsertDocumentReadEvent(events, {
      filename: "Agreement.docx",
      documentId: "document-2",
      status: "read",
    });
    events = upsertDocumentReadEvent(events, {
      filename: "Agreement.docx",
      documentId: "document-2",
      status: "reading",
    });

    expect(events.filter((event) => event.type === "doc_read")).toEqual([
      {
        type: "doc_read",
        filename: "Agreement.docx",
        documentId: "document-1",
        status: "reading",
      },
      {
        type: "doc_read",
        filename: "Agreement.docx",
        documentId: "document-2",
        status: "read",
      },
    ]);
  });

  test("keeps content segments on both sides of document activity", () => {
    let events: WordAssistantEvent[] = [
      { type: "thinking", isStreaming: true },
    ];
    events = appendAssistantContent(events, "I’ll inspect the document.");
    events = upsertDocumentReadEvent(events, {
      filename: "Agreement.docx",
      documentId: "document-1",
      status: "read",
    });
    events = appendAssistantContent(events, "The agreement has three risks.");

    expect(events).toEqual([
      { type: "content", text: "I’ll inspect the document." },
      {
        type: "doc_read",
        filename: "Agreement.docx",
        documentId: "document-1",
        status: "read",
      },
      { type: "content", text: "The agreement has three risks." },
    ]);
  });

  test("replaces Thinking with a real reasoning block and finalizes it", () => {
    let events: WordAssistantEvent[] = [
      { type: "thinking", isStreaming: true },
    ];
    events = appendAssistantReasoning(events, "Inspect the ");
    events = appendAssistantReasoning(events, "agreement.");

    expect(events).toEqual([
      {
        type: "reasoning",
        text: "Inspect the agreement.",
        isStreaming: true,
      },
    ]);

    events = finishAssistantReasoning(events);
    events = appendAssistantContent(events, "The agreement is valid.");
    expect(events).toEqual([
      { type: "reasoning", text: "Inspect the agreement." },
      { type: "content", text: "The agreement is valid." },
    ]);
  });

  test("retains a mixed cloud event array losslessly and in order", () => {
    const storedEvents = [
      { type: "content", text: "I’ll inspect the document." },
      {
        type: "reasoning",
        text: "Choose the active document read tool.",
        provider_metadata: { trace_id: "trace-1" },
      },
      {
        type: "doc_read",
        filename: "Agreement.docx",
        document_id: "document-1",
        source: "word_context",
      },
      { type: "content", text: "The agreement has three risks." },
      { type: "error", message: "A stored follow-up failed." },
    ];

    const events = normalizeStoredAssistantEvents(storedEvents);
    expect(events.map((event) => event.type)).toEqual([
      "content",
      "reasoning",
      "doc_read",
      "content",
      "error",
    ]);
    expect(events[1]).toEqual(storedEvents[1]);
    expect(events[2]).toEqual({
      ...storedEvents[2],
      documentId: "document-1",
      status: "read",
    });

    const message = messageFromStorage(
      {
        id: "assistant-cloud",
        role: "assistant",
        content: "I’ll inspect the document.The agreement has three risks.",
        events,
      },
      "fallback",
    );
    if (message.role !== "assistant") {
      throw new Error("Expected an assistant message.");
    }
    expect(message.events[1]).toEqual(storedEvents[1]);
    expect(assistantContent(message)).toBe(
      "I’ll inspect the document.The agreement has three risks.",
    );
    expect(assistantError(message)).toBe("A stored follow-up failed.");
  });

  test("discards transient activity while preserving completed reads and content", () => {
    let events: WordAssistantEvent[] = [
      { type: "thinking", isStreaming: true },
    ];
    events = upsertDocumentReadEvent(events, {
      filename: "Pending.docx",
      documentId: "pending",
      status: "reading",
    });
    events = upsertDocumentReadEvent(events, {
      filename: "Complete.docx",
      documentId: "complete",
      status: "read",
    });
    events = appendAssistantContent(events, "Done");

    expect(completeAssistantEvents(events)).toEqual([
      {
        type: "doc_read",
        filename: "Complete.docx",
        documentId: "complete",
        status: "read",
      },
      { type: "content", text: "Done" },
    ]);
  });
});
