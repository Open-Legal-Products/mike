/**
 * Word-chat streaming boundary for the task pane.
 *
 * Passes documentContext through, renders only `content_delta` frames, throws
 * on a pre-`[DONE]` `error` frame, and rejects a response that ends without a
 * terminal `[DONE]`. Framing rules live in the local HTTP client's readSSE.
 */
import { streamWordChat, readSSE } from "./mikeApi";

export async function streamAssistant(
  params: {
    messages: {
      role: string;
      content: string;
      files?: { filename: string; document_id?: string }[];
      // Workflow runs travel as a reference — the backend resolves the body
      // server-side (inside the <workflow-instructions> fence), same as the web.
      workflow?: { id: string; title: string };
    }[];
    documentContext?: string;
    model: string;
    chatId?: string;
    wordDocumentId: string;
    wordChatStorage: "cloud" | "local";
    signal?: AbortSignal;
    onMetadata?: (metadata: {
      chatId?: string;
      assistantMessageId?: string;
    }) => void;
  },
  onText: (text: string) => void
): Promise<void> {
  const res = await streamWordChat({
    messages: params.messages,
    model: params.model,
    chat_id: params.chatId,
    document_context: params.documentContext,
    document_id: params.wordDocumentId,
    storage: params.wordChatStorage,
    signal: params.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Chat request failed (${res.status}): ${body}`);
  }
  let streamError: string | null = null;
  const result = await readSSE(
    res,
    (data) => {
      const d = data as Record<string, unknown>;
      if (d.type === "content_delta" && typeof d.text === "string" && d.text) {
        onText(d.text);
      } else if (d.type === "chat_id") {
        const chatId = typeof d.chatId === "string" ? d.chatId : undefined;
        const assistantMessageId =
          typeof d.assistantMessageId === "string"
            ? d.assistantMessageId
            : undefined;
        if (chatId || assistantMessageId) {
          params.onMetadata?.({ chatId, assistantMessageId });
        }
      } else if (d.type === "error") {
        streamError = typeof d.message === "string" ? d.message : "Stream error";
      }
    },
    { signal: params.signal }
  );
  if (streamError) throw new Error(streamError);
  if (!result.done && !params.signal?.aborted) {
    throw new Error("Chat stream ended before the completion marker.");
  }
}
