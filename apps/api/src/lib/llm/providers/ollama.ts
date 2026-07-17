/**
 * Ollama provider — routes Ollama model IDs through the OpenAI-compatible
 * streaming backend pointed at a local Ollama server.
 *
 * Prerequisites:
 *   OPENAI_BASE_URL=http://localhost:11434/v1
 *   OPENAI_ALLOW_LOCAL_BASE_URL=true
 *   OPENAI_API_KEY=ollama              # Ollama accepts any non-empty string
 *
 * Call setupOllama() once from your app bootstrap before any LLM calls:
 *
 *   import { setupOllama } from "lib/llm/providers/ollama";
 *   setupOllama();
 *   // or pass a custom list:
 *   setupOllama({ models: ["llama3.3", "phi4", "my-custom-model"] });
 *
 * This pattern demonstrates how to add any OpenAI-compatible provider
 * (OpenRouter, Mistral AI, Together AI, Anyscale, etc.) without modifying
 * any core file — only a call to registerProvider() and registerApiKeyProvider().
 */

import { registerProvider } from "../registry";
import { streamOpenAI, completeOpenAIText } from "../openai";
import { registerApiKeyProvider } from "../../../core/apiKeyProviders";

const DEFAULT_MODELS = [
    // Meta Llama
    "llama3.3", "llama3.2", "llama3.1", "llama3",
    // Mistral
    "mistral", "mistral-nemo", "mistral-small",
    // Microsoft Phi
    "phi4", "phi4-mini",
    // Alibaba Qwen
    "qwen2.5", "qwen2.5-coder",
    // Google Gemma
    "gemma3", "gemma2",
    // DeepSeek
    "deepseek-r1", "deepseek-coder-v2",
];

export interface OllamaSetupOptions {
    /** Model IDs to register (merged with defaults). */
    models?: string[];
}

/**
 * Opt-in bootstrap: register the Ollama provider iff `ENABLE_OLLAMA=true`.
 *
 * Gated (not always-on) because registering ~20 local model IDs would pollute
 * the model picker on cloud deployments that have no Ollama server, and because
 * running Ollama also requires `OPENAI_ALLOW_LOCAL_BASE_URL=true` — a deliberate
 * SSRF-guard relaxation we only want when a self-hoster asks for it. Optional
 * `OLLAMA_MODELS` (comma-separated) adds custom models to the defaults.
 *
 * Returns true if it registered the provider. `env` is injectable for testing.
 */
export function setupOllamaFromEnv(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (env.ENABLE_OLLAMA !== "true") return false;
    const models = (env.OLLAMA_MODELS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    setupOllama({ models });
    return true;
}

export function setupOllama(options: OllamaSetupOptions = {}): void {
    const id = "ollama";
    const allModels = [...new Set([...DEFAULT_MODELS, ...(options.models ?? [])])];
    const modelSet = new Set(allModels);

    // No dedicated API key — Ollama reuses OPENAI_API_KEY (set to any string).
    registerApiKeyProvider(id, ["OPENAI_API_KEY"]);

    registerProvider({
        id,
        matchesModel: (m) => modelSet.has(m),
        // Ollama exposes an OpenAI Responses-compatible API on port 11434.
        // The base URL is resolved from OPENAI_BASE_URL by the openai adapter.
        stream: streamOpenAI,
        complete: completeOpenAIText,
        models: { main: allModels, mid: [], low: [] },
    });
}
