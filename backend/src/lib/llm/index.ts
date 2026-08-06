import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { streamOllama, completeOllamaText } from "./ollama";
import {
    streamOpenRouter,
    completeOpenRouterText,
    streamVercel,
    completeVercelText,
} from "./openrouter";
import { streamOpenCodeGo, completeOpenCodeGoText } from "./openCodeGo";
import { registerProvider, getRegisteredProvider } from "./registry";
import {
    providerForModel,
    CLAUDE_MAIN_MODELS,
    CLAUDE_MID_MODELS,
    CLAUDE_LOW_MODELS,
    GEMINI_MAIN_MODELS,
    GEMINI_MID_MODELS,
    GEMINI_LOW_MODELS,
    OPENAI_MAIN_MODELS,
    OPENAI_MID_MODELS,
    OPENAI_LOW_MODELS,
} from "./models";
import type { StreamChatParams, StreamChatResult, CompleteTextParams } from "./types";

export * from "./types";
export * from "./models";

/**
 * Register a third-party LLM provider so it is available via
 * streamChatWithTools() and completeText().
 *
 * OpenAI-compatible providers can be added the same way — call
 * registerProvider()/registerApiKeyProvider(), no core edits.
 */
export { registerProvider, providerDisplayLabel } from "./registry";

// ---------------------------------------------------------------------------
// Register built-in providers
// ---------------------------------------------------------------------------
// Providers are imported above so that Vitest's vi.mock() hoisting works:
// test files mock e.g. "../claude" before this module loads, so the mocked
// function is captured here and ends up in the registry.

/**
 * Register the built-in LLM providers: the three first-party model families
 * (claude/gemini/openai), the local Ollama runtime, and the three router
 * providers whose catalogs are fetched at runtime (openrouter/vercel/
 * opencode-go).  Routers are registered first so their namespaced ids
 * ("openrouter/…", "vercel/…", "opencode-go/…") are matched before the
 * bare-prefix matchers below ever see them.
 */
export function registerBuiltinProviders(): void {
    registerProvider({
        id: "openrouter",
        label: "OpenRouter",
        // Router catalogs are fetched at runtime (see lib/routerModels), so
        // there is no static model list — the namespace prefix is the match.
        matchesModel: (m) => m.startsWith("openrouter/"),
        stream: streamOpenRouter,
        complete: completeOpenRouterText,
        models: [],
    });
    registerProvider({
        id: "vercel",
        label: "Vercel AI Gateway",
        matchesModel: (m) => m.startsWith("vercel/"),
        stream: streamVercel,
        complete: completeVercelText,
        models: [],
    });
    registerProvider({
        id: "opencode-go",
        label: "OpenCode Go",
        matchesModel: (m) => m.startsWith("opencode-go/"),
        stream: streamOpenCodeGo,
        complete: completeOpenCodeGoText,
        models: [],
    });
    registerProvider({
        id: "claude",
        label: "Anthropic",
        matchesModel: (m) => m.startsWith("claude"),
        stream: streamClaude,
        complete: completeClaudeText,
        models: [...CLAUDE_MAIN_MODELS, ...CLAUDE_MID_MODELS, ...CLAUDE_LOW_MODELS],
    });
    registerProvider({
        id: "gemini",
        label: "Gemini",
        matchesModel: (m) => m.startsWith("gemini"),
        stream: streamGemini,
        complete: completeGeminiText,
        models: [...GEMINI_MAIN_MODELS, ...GEMINI_MID_MODELS, ...GEMINI_LOW_MODELS],
    });
    registerProvider({
        id: "openai",
        label: "OpenAI",
        matchesModel: (m) => m.startsWith("gpt-"),
        stream: streamOpenAI,
        complete: completeOpenAIText,
        models: [...OPENAI_MAIN_MODELS, ...OPENAI_MID_MODELS, ...OPENAI_LOW_MODELS],
    });
    registerProvider({
        id: "ollama",
        label: "Local (Ollama)",
        // Ollama models are detected dynamically (see GET /models/ollama);
        // any "ollama/<tag>" id routes here, so no static model list.
        matchesModel: (m) => m.startsWith("ollama"),
        stream: streamOllama,
        complete: completeOllamaText,
        models: [],
    });
}

registerBuiltinProviders();

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

function requireAdapter(providerId: string, model: string) {
    const adapter = getRegisteredProvider(providerId);
    if (!adapter) {
        throw new Error(
            `LLM provider "${providerId}" matched model "${model}" but is not registered. ` +
            `Import "lib/llm" to initialize built-in providers, ` +
            `or call registerProvider() for third-party providers.`,
        );
    }
    return adapter;
}

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const providerId = providerForModel(params.model);
    const adapter = requireAdapter(providerId, params.model);
    return adapter.stream(params);
}

export async function completeText(params: CompleteTextParams): Promise<string> {
    const providerId = providerForModel(params.model);
    const adapter = requireAdapter(providerId, params.model);
    return adapter.complete(params);
}
