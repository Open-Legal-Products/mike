/**
 * Helpers for specs that require a live LLM turn.
 *
 * Four specs (chat rename, chat delete, project-assistant create+submit, and
 * the critical-path "ask a question" flow) create/populate a chat by sending a
 * message. This codebase ships no keyless model: every entry in the model
 * picker (frontend/src/app/components/assistant/ModelToggle.tsx MODELS) is an
 * Anthropic/Google/OpenAI model whose availability requires a configured
 * provider key — backend env var or user-stored key
 * (backend/src/lib/userApiKeys.ts) — and ChatInput.handleSubmit refuses to
 * send when the selected model's key is missing (ApiKeyMissingPopup). The
 * backend enforces the same model set server-side
 * (backend/src/lib/llm/models.ts ALL_MODELS/providerForModel). So with no key
 * there is no way for these specs to send a message at all; unguarded they
 * would hang to their timeout.
 *
 * The auto title-generation call (POST /chat/:id/generate-title) is NOT why
 * the gate exists: keyless it just returns 500, and the specs already treat it
 * as best-effort (`.catch(() => null)`).
 *
 * In CI the key is the `ANTHROPIC_API_KEY` repository secret, which
 * `.github/workflows/e2e.yml` exposes both to the backend (backend/.env) and
 * to the Playwright process. Guarding with
 * `test.skip(!hasLlmKey, LLM_SKIP_REASON)` keeps a keyless run (a plain local
 * run, or a fork PR with no secret access) green and fast on the other 23
 * specs, while still running — and enforcing — the LLM specs whenever the key
 * is present. Setup steps: docs/e2e-ci.md, "Enable the LLM specs".
 *
 * Known gap: the specs' selectDemoModel helper still targets a keyless
 * "Demo (no key needed)" model that exists in the amal66 fork but not in this
 * repository, so once unskipped they additionally need that helper pointed at
 * a Claude model (see docs/e2e-ci.md, "Known gap: model selection"). The
 * skip-guard itself is correct either way — keyless, no model in this repo
 * can send.
 */
export const hasLlmKey = Boolean(process.env.ANTHROPIC_API_KEY);

export const LLM_SKIP_REASON =
    "requires a model key — set the ANTHROPIC_API_KEY secret to run LLM-dependent specs";
