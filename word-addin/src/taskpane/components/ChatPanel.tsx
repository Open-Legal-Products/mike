import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Input,
  Text,
  Switch,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  controlsBar: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  messageList: {
    flex: "1 1 0",
    overflowY: "auto",
    padding: tokens.spacingVerticalS,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  emptyState: {
    flex: "1 1 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.colorNeutralForeground3,
  },
  bubble: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    maxWidth: "92%",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    backgroundColor: tokens.colorBrandBackground2,
    alignSelf: "flex-end",
  },
  assistantBubble: {
    backgroundColor: tokens.colorNeutralBackground3,
    alignSelf: "flex-start",
  },
  insertBtn: {
    marginTop: tokens.spacingVerticalXS,
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    flexWrap: "wrap",
  },
  typingRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
  },
  inputRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    alignItems: "flex-end",
  },
  inputField: {
    flex: "1 1 0",
  },
});

export function ChatPanel(): React.ReactElement {
  const styles = useStyles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [useDocContext, setUseDocContext] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { readDocumentText, insertAtCursor, insertWithTrackChanges } = useWordDoc();

  // Auto-scroll on new content
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streaming]);

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

    try {
      await apiClient.stream(
        "/chat",
        { messages: history, documentContext },
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
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className={styles.root}>
      {/* Context toggle */}
      <div className={styles.controlsBar}>
        <Switch
          label="Use document as context"
          checked={useDocContext}
          onChange={(_, d) => setUseDocContext(d.checked)}
          disabled={streaming}
        />
      </div>

      {/* Message list */}
      {!hasMessages && !streaming ? (
        <div className={styles.emptyState}>
          <Text>Ask anything about your document</Text>
        </div>
      ) : (
        <div className={styles.messageList} ref={listRef}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`${styles.bubble} ${
                msg.role === "user"
                  ? styles.userBubble
                  : styles.assistantBubble
              }`}
            >
              <Text>{msg.content}</Text>
              {msg.role === "assistant" && msg.content && (
                <div className={styles.insertBtn}>
                  <Button
                    size="small"
                    appearance="outline"
                    onClick={() => void insertAtCursor(msg.content)}
                  >
                    Insert at cursor
                  </Button>
                  <Button
                    size="small"
                    appearance="outline"
                    onClick={() => void insertWithTrackChanges(msg.content)}
                  >
                    Apply as tracked change
                  </Button>
                </div>
              )}
            </div>
          ))}
          {streaming && (
            <div className={styles.typingRow}>
              <Spinner size="tiny" />
              <Text size={200}>Thinking…</Text>
            </div>
          )}
        </div>
      )}

      {/* Input bar */}
      <div className={styles.inputRow}>
        <Input
          className={styles.inputField}
          placeholder="Ask Mike…"
          value={input}
          onChange={(_, d) => setInput(d.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        <Button
          appearance="primary"
          onClick={() => void handleSend()}
          disabled={!input.trim() || streaming}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
