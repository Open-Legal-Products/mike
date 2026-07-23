import React, { useState, useRef, useEffect } from "react";
import { MessageSquareText } from "lucide-react";
import { streamAssistant } from "../api/stream";
import { useWordDoc } from "../hooks/useWordDoc";
import { UserBubble, AssistantBubble } from "@mike/shared/chat/ChatBubble";
import { ChatInput } from "@mike/shared/chat/ChatInput";
import { Button } from "@mike/shared/ui/button";
import { Switch } from "@mike/shared/ui/switch";
import { Spinner } from "@mike/shared/ui/spinner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel(): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [useDocContext, setUseDocContext] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const { readDocumentText, insertBelowSelection } = useWordDoc();

  // Auto-scroll on new content
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Abort any in-flight stream when the panel unmounts (e.g. switching tabs) so
  // we neither keep the connection open nor setState on an unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const handleCancel = (): void => abortRef.current?.abort();

  const handleSend = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;

    let documentContext: string | undefined;
    if (useDocContext) {
      try {
        documentContext = await readDocumentText();
      } catch {
        documentContext = undefined;
      }
    }

    const userMsg: Message = { role: "user", content: text };
    const history: Message[] = [...messages, userMsg];

    setMessages(history);
    setInput("");
    setStreaming(true);

    // Append empty assistant slot so the user sees it filling in
    const withPlaceholder: Message[] = [
      ...history,
      { role: "assistant", content: "" },
    ];
    setMessages(withPlaceholder);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAssistant(
        { messages: history, documentContext, signal: controller.signal },
        (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
            }
            return next;
          });
        }
      );
    } catch (e) {
      // A user-initiated stop or an unmount aborts the request — keep whatever
      // partial answer streamed in, don't render it as an error.
      if (controller.signal.aborted || !mountedRef.current) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content:
              e instanceof Error ? `Error: ${e.message}` : "An error occurred.",
          };
        }
        return next;
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setStreaming(false);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Message list */}
      {!hasMessages && !streaming ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquareText className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Ask anything about your document
            </p>
            <p className="text-xs text-muted-foreground">
              Mike can summarize, explain, and draft — toggle document context
              below to ground answers in your file.
            </p>
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 @sm:px-4"
        >
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <UserBubble key={i} content={msg.content} />
            ) : (
              <AssistantBubble
                key={i}
                content={msg.content}
                actions={
                  msg.content ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void insertBelowSelection(msg.content)}
                      >
                        Insert below cursor
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void insertBelowSelection(msg.content, true)}
                      >
                        Insert below (tracked)
                      </Button>
                    </>
                  ) : undefined
                }
              />
            )
          )}
          {streaming && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              <span>Thinking…</span>
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 border-t border-border/70 p-3 @sm:p-4">
        <ChatInput
          value={input}
          onValueChange={setInput}
          onSubmit={() => void handleSend()}
          isLoading={streaming}
          onCancel={handleCancel}
          disabled={streaming}
          placeholder="Ask Mike…"
          leftSlot={
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch
                checked={useDocContext}
                onCheckedChange={(v) => setUseDocContext(!!v)}
                disabled={streaming}
                aria-label="Use document as context"
              />
              <span className="truncate">Use document as context</span>
            </label>
          }
        />
      </div>
    </div>
  );
}
