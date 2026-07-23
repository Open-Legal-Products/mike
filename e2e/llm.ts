/**
 * Helpers for specs that require a live LLM turn.
 *
 * A few specs create/populate a chat by sending a message and awaiting a
 * streamed answer. That only works when a model key is configured — in CI the
 * `ANTHROPIC_API_KEY` secret, which `.github/workflows/e2e.yml` exposes to the
 * Playwright process. When it is absent (a plain local run, or a fork PR with no
 * secret access) the app blocks message send behind the ApiKeyMissingModal, so
 * these specs would hang to their timeout.
 *
 * Guarding them with `test.skip(!hasLlmKey, LLM_SKIP_REASON)` keeps a keyless
 * run green and fast on the ~20 specs that don't need a model, while still
 * running — and enforcing — the LLM specs whenever the key is present.
 */
export const hasLlmKey = Boolean(process.env.ANTHROPIC_API_KEY);

export const LLM_SKIP_REASON =
    "requires a model key — set the ANTHROPIC_API_KEY secret to run LLM-dependent specs";
