# Extending Mike

Mike's backend exposes six registry-based extension points. Each one is a
single-file operation: implement the interface, call the register function at
startup, and no core file changes. The design is documented in
[ADR 0001](adr/0001-registry-based-extensibility.md); this page is the
practitioner's guide.

| Extension point | Interface | Register with | Source |
| --- | --- | --- | --- |
| Chat/LLM provider | `LLMProviderAdapter` | `registerProvider()` | `apps/api/src/lib/llm/registry.ts` |
| API-key provider | (table entry) | `registerApiKeyProvider()` | `apps/api/src/core/apiKeyProviders.ts` |
| Embedding provider | `EmbeddingProviderAdapter` | `registerEmbeddingProvider()` | `apps/api/src/lib/llm/embeddings/registry.ts` |
| Storage backend | `StorageAdapter` | `setStorageAdapter()` | `apps/api/src/lib/storage/adapter.ts` |
| LLM tool handler | `ToolHandler` | `registerToolHandler()` | `apps/api/src/lib/tools/registry/index.ts` |
| Law library (jurisdiction) | `LawLibraryPlugin` | `registerLawLibrary()` | `apps/api/src/lib/lawLibraries/registry.ts` |

There is also a **no-code** extension path: users can connect remote
[MCP](https://modelcontextprotocol.io) servers from the account → connectors
page, which adds their tools to chat without touching the codebase at all.

## Worked example: a new LLM provider

`apps/api/src/lib/llm/providers/ollama.ts` is the reference implementation —
read it alongside this section. It plugs local Ollama models into chat by
composing two registry calls and reusing the existing OpenAI-compatible
transport:

```ts
import { registerProvider } from "../registry";
import { streamOpenAI, completeOpenAIText } from "../openai";
import { registerApiKeyProvider } from "../../../core/apiKeyProviders";

registerProvider({
    id: "ollama",
    matchesModel: (model) => OLLAMA_MODELS.includes(model),
    stream: streamOpenAI,          // Ollama speaks the OpenAI wire format
    complete: completeOpenAIText,
    models: { main: OLLAMA_MODELS, mid: [], low: [] },
});
registerApiKeyProvider("ollama", []); // no API key required
```

Because `resolveModel()` consults `allRegisteredModels()` and
`findProviderForModel()` before its built-in prefix heuristics, the new
models are valid and routed correctly the moment the provider is registered —
`models.ts`, `userApiKeys.ts`, and the routes are untouched. Any
OpenAI-compatible host (OpenRouter, Mistral, Together, Anyscale) works the
same way; a provider with its own wire format implements `stream`/`complete`
directly (see `claude.ts` or `gemini.ts` for the shape).

Providers should be **gated behind an env flag** (Ollama uses
`ENABLE_OLLAMA=true`) so deployments that don't run them don't get their
models in the picker.

## Worked example: a new jurisdiction

`apps/api/src/lib/lawLibraries/examples/danishLaw.ts` shows the pattern: a
`LawLibraryPlugin` contributes a system-prompt fragment (citation
conventions), optional tool schemas (`danish_law_search`), and an optional
per-turn context fetcher for live statute lookups. Register the matching
tool *executor* with `registerToolHandler()` — note that built-in handlers
always win name collisions, so a plugin cannot shadow a built-in tool and
bypass its prompt-injection fencing.

## Storage backends

Two adapters ship in-tree: `R2StorageAdapter` (Cloudflare R2 / any
S3-compatible endpoint, the default) and `GCSStorageAdapter` (Google Cloud
Storage). To target anything else, implement `StorageAdapter` (upload,
download, delete, list, signed URLs, health check) and call
`setStorageAdapter()` at startup. Adapter unit tests live in
`apps/api/src/lib/storage/__tests__/` — copy one as a starting point; a new
adapter should land with the equivalent suite.

## Client-side extension

External consumers integrate through the SDKs rather than the registries:

- **JS/TS:** `@mike/sdk-js` (`packages/sdk-js`) — `new MikeClient({ baseUrl, apiKey })`.
- **Python:** `sdks/python` — `MikeClient(base_url=..., access_token=...)`.

Both are tested in CI. The `.mikeworkflow.json` interchange format for
sharing workflows is specified by `schemas/workflow.schema.json`, which is
generated from the zod schema in
`apps/api/src/modules/workflows/workflowFormat.ts` — that zod schema is the
single source of truth, and a drift test keeps the published file in sync.

## Ground rules for contributions

1. **Register, don't edit.** If adding your feature requires editing a core
   dispatch site, that's a smell — look for the registry, or propose one.
2. **Gate optional surface behind env flags, off by default** (see ADR 0002
   and 0003). Self-hosters should get zero new dependencies or egress unless
   they opt in; `AIRGAPPED=true` must keep working.
3. **Land the test with the extension.** Every registry has a
   `_reset...ForTesting()` hook for isolated unit tests.
