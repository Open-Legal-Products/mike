// Shared abort helper. Lives in its own leaf module so both runToolCalls and
// the streaming loop can import it without creating a cycle between them.

export function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  throw err;
}
