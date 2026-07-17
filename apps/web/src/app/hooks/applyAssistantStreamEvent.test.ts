import { describe, it, expect, vi } from "vitest";
import {
  applyAssistantStreamEvent,
  type StreamEventContext,
} from "./applyAssistantStreamEvent";
import type { AssistantEvent } from "@/app/components/shared/types";

/**
 * Build a StreamEventContext whose buffer mutators are spies but whose
 * `eventsRef` is a real ref, so we can assert both "which mutator was called"
 * (for events that route through pushEvent / updateMatchingEvent) and "how the
 * buffer changed" (for events that write eventsRef.current directly, like
 * content_delta and error).
 */
function makeCtx(initial: AssistantEvent[] = []) {
  const ctx = {
    eventsRef: { current: [...initial] },
    setMessages: vi.fn(),
    setChatId: vi.fn(),
    setCurrentChatId: vi.fn(),
    setIsLoadingCitations: vi.fn(),
    setIsResponseLoading: vi.fn(),
    onChatId: vi.fn(),
    clearStreamingPlaceholders: vi.fn(),
    finalizeStreamingContent: vi.fn(),
    finalizeStreamingReasoning: vi.fn(),
    pushEvent: vi.fn(),
    updateMatchingEvent: vi.fn(() => true),
    pushThinkingPlaceholder: vi.fn(),
  };
  return ctx;
}

function apply(data: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>) {
  applyAssistantStreamEvent(data, ctx as unknown as StreamEventContext);
}

describe("applyAssistantStreamEvent", () => {
  it("chat_id records the id through onChatId + both setters", () => {
    const ctx = makeCtx();
    apply({ type: "chat_id", chatId: "chat-123" }, ctx);
    expect(ctx.onChatId).toHaveBeenCalledWith("chat-123");
    expect(ctx.setChatId).toHaveBeenCalledWith("chat-123");
    expect(ctx.setCurrentChatId).toHaveBeenCalledWith("chat-123");
  });

  it("content_done flips the citations-loading flag on", () => {
    const ctx = makeCtx();
    apply({ type: "content_done" }, ctx);
    expect(ctx.setIsLoadingCitations).toHaveBeenCalledWith(true);
  });

  it("error appends an error event, finalizes streams, and clears loading flags", () => {
    const ctx = makeCtx();
    apply({ type: "error", message: "invalid x-api-key" }, ctx);

    expect(ctx.clearStreamingPlaceholders).toHaveBeenCalled();
    expect(ctx.finalizeStreamingContent).toHaveBeenCalled();
    expect(ctx.finalizeStreamingReasoning).toHaveBeenCalled();
    expect(ctx.eventsRef.current).toEqual([
      { type: "error", message: "invalid x-api-key" },
    ]);
    expect(ctx.setIsResponseLoading).toHaveBeenCalledWith(false);
    expect(ctx.setIsLoadingCitations).toHaveBeenCalledWith(false);
  });

  it("error with a non-string message uses the friendly fallback", () => {
    const ctx = makeCtx();
    apply({ type: "error", message: null }, ctx);
    expect(ctx.eventsRef.current.at(-1)).toEqual({
      type: "error",
      message: "Sorry, something went wrong.",
    });
  });

  it("content_delta starts a streaming block and accumulates across deltas", () => {
    const ctx = makeCtx();
    apply({ type: "content_delta", text: "Hello " }, ctx);
    apply({ type: "content_delta", text: "world" }, ctx);
    expect(ctx.clearStreamingPlaceholders).toHaveBeenCalled();
    expect(ctx.eventsRef.current).toEqual([
      { type: "content", text: "Hello world", isStreaming: true },
    ]);
  });

  it("a tool _start event pushes a streaming placeholder tool event", () => {
    const ctx = makeCtx();
    apply({ type: "doc_read_start", filename: "brief.pdf" }, ctx);
    expect(ctx.pushEvent).toHaveBeenCalledWith({
      type: "doc_read",
      filename: "brief.pdf",
      isStreaming: true,
    });
  });

  it("a tool completion event finalizes the match and re-arms the thinking placeholder", () => {
    const ctx = makeCtx();
    apply({ type: "doc_read", filename: "brief.pdf" }, ctx);
    expect(ctx.updateMatchingEvent).toHaveBeenCalled();
    expect(ctx.pushThinkingPlaceholder).toHaveBeenCalled();
  });

  it("ignores unknown event types without touching the buffer or setters", () => {
    const ctx = makeCtx();
    apply({ type: "totally_unknown_event", foo: 1 }, ctx);
    expect(ctx.eventsRef.current).toEqual([]);
    expect(ctx.pushEvent).not.toHaveBeenCalled();
    expect(ctx.setMessages).not.toHaveBeenCalled();
    expect(ctx.onChatId).not.toHaveBeenCalled();
  });
});
