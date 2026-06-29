/// <reference types="office-js" />

import { getFreshAccessToken, refreshSession } from "../auth/session";

const BASE_URL: string =
  process.env.REACT_APP_API_BASE_URL ?? "http://localhost:3001";

// The Mike API falls back to a default model when none is supplied, and that
// default may have no configured API key — in which case the SSE stream emits a
// single `{"type":"error"}` event and zero content. To avoid silent blank
// replies we inject a known-keyed model into every /chat request that doesn't
// already specify one. Overridable at build time via REACT_APP_DEFAULT_MODEL.
// Guard the `process` reference: webpack's EnvironmentPlugin only substitutes
// registered vars, and webpack-dev-server does NOT reload its config on edit, so
// a stale dev server can leave this as a literal `process.env...` that throws
// "process is not defined" in the browser and white-screens the add-in. The
// typeof guard short-circuits before touching `process`, falling back safely.
const DEFAULT_MODEL: string =
  (typeof process !== "undefined" && process.env.REACT_APP_DEFAULT_MODEL) ||
  "claude-sonnet-4-6";

function withAuth(
  token: string | null,
  includeContentType: boolean,
  extra?: HeadersInit
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return { ...headers, ...((extra as Record<string, string>) ?? {}) };
}

/**
 * Fetch a Mike API endpoint with the current Bearer token, transparently
 * recovering from an expired session. The token is refreshed proactively when
 * it's already known to be stale (getFreshAccessToken); if the server still
 * answers 401 — e.g. the token was revoked server-side — we refresh once
 * reactively and replay the request with the new token. A refresh that fails
 * clears the session (handled inside refreshSession), so we don't loop.
 */
async function authedFetch(
  path: string,
  init: RequestInit,
  includeContentType: boolean
): Promise<Response> {
  const token = await getFreshAccessToken();
  let res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: withAuth(token, includeContentType, init.headers),
  });

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed && refreshed !== token) {
      res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: withAuth(refreshed, includeContentType, init.headers),
      });
    }
  }

  return res;
}

async function get<T>(path: string): Promise<T> {
  const res = await authedFetch(path, { method: "GET" }, false);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(
    path,
    {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    true
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await authedFetch(path, { method: "DELETE" }, false);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Stream a Mike API SSE response, forwarding visible answer text to `onChunk`.
 *
 * The chat SSE protocol emits framed events as `data: <json>\n\n`. Only
 * `{"type":"content_delta","text":"..."}` events carry the visible answer —
 * other event types (chat_id, reasoning_delta, citations, doc_*, tool_call_*)
 * must NOT be rendered. The stream terminates with `[DONE]`; the API may emit a
 * harmless trailing `{"type":"error"}` AFTER that first `[DONE]`, so we stop
 * processing at the first `[DONE]`. A genuine `{"type":"error"}` that arrives
 * BEFORE `[DONE]` is surfaced by throwing, so real failures aren't silent.
 *
 * For /chat requests we inject DEFAULT_MODEL unless the caller already set one.
 */
async function stream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void
): Promise<void> {
  // Inject a keyed default model into chat requests that lack one.
  let requestBody = body;
  if (
    path.startsWith("/chat") &&
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    const obj = body as Record<string, unknown>;
    const hasModel =
      typeof obj.model === "string" && obj.model.trim().length > 0;
    if (!hasModel) {
      requestBody = { ...obj, model: DEFAULT_MODEL };
    }
  }

  const res = await authedFetch(
    path,
    { method: "POST", body: JSON.stringify(requestBody) },
    true
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`STREAM ${path} failed (${res.status}): ${text}`);
  }

  if (!res.body) {
    throw new Error("Response body is null — streaming not supported");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let doneSeen = false;
  let streamError: string | null = null;

  const processLine = (line: string): void => {
    if (doneSeen) return;
    const trimmed = line.trim();
    if (!trimmed) return;

    // SSE frames look like "data: <json>"; tolerate a missing space too.
    const jsonStr = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!jsonStr) return;

    if (jsonStr === "[DONE]") {
      doneSeen = true;
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      // Non-JSON control noise — ignore.
      return;
    }

    const type = parsed["type"];
    if (type === "content_delta") {
      const text = parsed["text"];
      if (typeof text === "string" && text) onChunk(text);
    } else if (type === "error") {
      // A real, pre-[DONE] failure. Capture and throw once the stream ends.
      const message = parsed["message"];
      streamError = typeof message === "string" ? message : "Stream error";
    }
    // All other event types are intentionally ignored.
  };

  while (!doneSeen) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      processLine(line);
      if (doneSeen) break;
    }
  }

  // Flush any remaining content in the buffer (if we didn't already stop).
  if (!doneSeen && buffer.trim()) {
    processLine(buffer);
  }

  if (streamError !== null) {
    throw new Error(streamError);
  }
}

export const apiClient = {
  get,
  post,
  delete: del,
  stream,
  /**
   * Escape hatch for callers that must control the request body themselves —
   * e.g. multipart uploads, where forcing `Content-Type: application/json`
   * would clobber the browser's multipart boundary. Still gets proactive +
   * reactive token refresh. Pass `includeContentType: false` for FormData.
   */
  fetch: authedFetch,
};
