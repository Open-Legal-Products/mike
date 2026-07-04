# 0001. Registry-based extensibility for LLM providers, embeddings, storage, and API-key lookup

- **Status:** Accepted
- **Date:** 2026-05-24  (registry + storage adapter landed; GCS/Vertex adapter 2026-06-30)
- **Commit(s):** `f98c209` refactor: provider registry, storage adapter, table-driven api-key lookup; `57c1c1b` feat(google-cloud): GCS storage adapter + Vertex AI Gemini provider; `e0aeb96` feat(api): configurable S3 region so the storage adapter is provider-portable

## Context

The platform must support multiple LLM vendors (Claude, Gemini, OpenAI, local
Ollama), multiple object stores (Cloudflare R2 / S3, GCS), and per-provider
user-API-key lookup — and self-hosters need to add their own without forking.
The pre-refactor code hard-coded providers behind `switch`/`if` chains, so every
new backend meant editing several core files (dispatch, model validation, key
lookup). That violates the open/closed principle and turns "add a provider" into
a risky cross-cutting change.

## Decision

Use a **plain in-process registry** — a `Map` plus `register`/`find` functions —
per extension point, keyed by a stable string interface:

- **LLM providers**: `LLMProviderAdapter` (`apps/api/src/lib/llm/registry.ts`) —
  `id`, `matchesModel(model)`, `stream`, `complete`, and the model tier lists.
  `registerProvider()` inserts; `findProviderForModel()` resolves in
  registration order (first match wins); `allRegisteredModels()` feeds model
  validation so externally registered models are recognized without editing
  `models.ts`.
- **Storage**: `StorageAdapter` (`apps/api/src/lib/storage/adapter.ts`), swapped
  at startup via `setStorageAdapter()`. Implementing the interface is sufficient
  — no other file changes.
- **Embeddings** and **API-key lookup** follow the same table-driven shape
  (`lib/llm/embeddings/registry.ts`, `core/apiKeyProviders`).

We deliberately did **not** adopt a DI container. The wiring is a handful of
module-load-time `register*()` calls; a container would add a framework,
indirection, and lifecycle complexity that a `Map` behind a small API doesn't
need at this size.

## Consequences

- **OCP holds, with proof.** Adding a whole provider is a *single-file*
  operation. Ollama is the worked example: `lib/llm/providers/ollama.ts`
  registers itself by **reusing the OpenAI adapter's** `streamOpenAI` /
  `completeOpenAIText` against a local base URL, and calls `registerProvider()`
  + `registerApiKeyProvider()` — touching zero core files. Any
  OpenAI-compatible vendor (OpenRouter, Mistral, Together) follows the same path.
- **Registration order is semantically load-bearing.** `findProviderForModel()`
  returns the first `matchesModel()` hit, so an externally registered provider
  can intentionally override routing for a model id — powerful, but it means
  registration order is part of the contract, not an accident.
- **State is process-local.** The registry lives in module scope, populated at
  import/boot (`registerBuiltinProviders()` runs on `lib/llm` import). This is
  fine because it's deterministic config, but tests must reset it
  (`_resetRegistryForTesting()`), and there is no cross-process discovery — every
  replica registers the same providers independently.
- **No compile-time guarantee that a matched provider is registered.** Model
  routing can name a provider id whose adapter wasn't registered (e.g. a cloud
  model in air-gapped mode); the code handles this explicitly with
  `requireAdapter()` / `assertModelAvailable()` rather than a type error.
