/**
 * Add-in chat streaming helper — replaces the old client.ts `stream()`.
 *
 * Preserves that behaviour exactly: injects a keyed DEFAULT_MODEL when the
 * caller supplies none, passes documentContext through, renders only
 * `content_delta` frames, throws on a pre-`[DONE]` `error` frame, and (via
 * readSSE's terminal `[DONE]`) ignores the harmless trailing post-`[DONE]`
 * error frame. Framing/parse rules live in @mike/api-client's readSSE now.
 */
import { streamChat, readSSE } from "./mikeApi";

// Guard `process` like client.ts did — a stale dev server can leave the
// substitution unapplied, and bare `process` throws in the browser.
const DEFAULT_MODEL: string =
  (typeof process !== "undefined" && process.env.REACT_APP_DEFAULT_MODEL) ||
  "claude-sonnet-4-6";

export async function streamAssistant(
  params: {
    messages: { role: string; content: string }[];
    documentContext?: string;
    model?: string;
    signal?: AbortSignal;
  },
  onText: (text: string) => void
): Promise<void> {
  const res = await streamChat({
    messages: params.messages,
    model: params.model ?? DEFAULT_MODEL,
    documentContext: params.documentContext,
    signal: params.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Chat request failed (${res.status}): ${body}`);
  }
  let streamError: string | null = null;
  await readSSE(
    res,
    (data) => {
      const d = data as Record<string, unknown>;
      if (d.type === "content_delta" && typeof d.text === "string" && d.text) {
        onText(d.text);
      } else if (d.type === "error") {
        streamError = typeof d.message === "string" ? d.message : "Stream error";
      }
    },
    { signal: params.signal }
  );
  if (streamError) throw new Error(streamError);
}
