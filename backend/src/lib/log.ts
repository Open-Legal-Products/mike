// Shared logging helpers. Six modules used to carry a byte-identical copy of
// `devLog`; this is the single definition they all import.

import { safeErrorLog } from "./safeError";

/**
 * Exported for call sites that gate WORK (extra lookups, payload assembly)
 * behind dev mode, not just the log line itself.
 */
export const isDev = process.env.NODE_ENV !== "production";

/**
 * Verbose tracing that is only useful while developing. Silent in production,
 * so call sites can log request/response shapes without a runtime cost or a
 * noisy production log.
 */
export const devLog = (...args: Parameters<typeof console.log>) => {
  if (isDev) console.log(...args);
};

/**
 * Always-on error log, tagged with the subsystem that produced it. The error
 * is run through `safeErrorLog` so API keys and other secrets that providers
 * echo back in messages and stacks never reach the log.
 */
export function logError(
  scope: string,
  err: unknown,
  ctx?: Record<string, unknown>,
) {
  const tag = `[${scope}]`;
  if (ctx) console.error(tag, safeErrorLog(err), ctx);
  else console.error(tag, safeErrorLog(err));
}
