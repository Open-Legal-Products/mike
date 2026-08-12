/**
 * Word's WebView reports every failed fetch — DNS, TLS, mixed content, a dead
 * dev server, a blocked origin — as the same opaque `TypeError: Load failed`
 * ("Failed to fetch" on Chromium). On its own that tells a user nothing and
 * tells a developer even less, so failures are rewritten to carry what was
 * actually attempted plus everything the thrown value knows about itself.
 */

function errorDetail(error: unknown, depth = 0): string {
  if (depth > 3) return "";
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    const cause = errorDetail((error as { cause?: unknown }).cause, depth + 1);
    return `${name}${error.message}${cause ? ` — caused by ${cause}` : ""}`;
  }
  if (typeof error === "string") return error;
  if (error === undefined || error === null) return "";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Build the message shown in the UI when a request never reached the server.
 * Keeps the host's own wording, and adds the request and the usual causes so
 * the reader can act on it instead of just seeing "Load failed".
 */
export function describeNetworkFailure(
  error: unknown,
  request: { method: string; url: string },
): string {
  const detail = errorDetail(error) || "the request failed";
  const origin = (() => {
    try {
      return new URL(request.url, window.location.href).origin;
    } catch {
      return request.url;
    }
  })();
  return (
    `Couldn’t reach ${request.method} ${request.url} — ${detail}. ` +
    `Check that the server at ${origin} is running and reachable from Word.`
  );
}
