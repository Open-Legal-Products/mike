/**
 * Ollama embedding provider — routes a local embedding model through the same
 * OpenAI-compatible `/v1/embeddings` endpoint the chat Ollama provider uses,
 * pointed at OPENAI_BASE_URL (e.g. http://ollama:11434/v1).
 *
 * This is the ONLY embedding adapter registered in air-gapped mode, so semantic
 * search keeps working locally with no cloud egress. The base URL flows through
 * resolveOpenAIBaseUrl() (the SSRF/air-gap guard), so it cannot reach a public
 * host when AIRGAPPED=true.
 *
 * nomic-embed-text is 768-dim natively; we do NOT send the OpenAI `dimensions`
 * param because the local backend may not honour it — the column width is 768.
 */
import type { UserApiKeys } from "../../types";
import { resolveOpenAIBaseUrl } from "../../baseUrl";
import { embedOpenAICompatible } from "../openai";
import type { EmbeddingProviderAdapter } from "../registry";

export const DEFAULT_OLLAMA_EMBEDDING_MODELS = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "all-minilm",
] as const;

function apiKey(override?: string | null): string {
    // Ollama accepts any non-empty string; reuse OPENAI_API_KEY like the chat
    // provider does.
    return override?.trim() || process.env.OPENAI_API_KEY?.trim() || "ollama";
}

export function createOllamaEmbeddingProvider(opts: {
    dimensions: number;
    model?: string;
    extraModels?: string[];
}): EmbeddingProviderAdapter {
    const allModels = [
        ...new Set<string>([
            ...DEFAULT_OLLAMA_EMBEDDING_MODELS,
            ...(opts.extraModels ?? []),
        ]),
    ];
    const modelSet = new Set<string>(allModels);
    const model =
        opts.model && modelSet.has(opts.model)
            ? opts.model
            : DEFAULT_OLLAMA_EMBEDDING_MODELS[0];
    return {
        id: "ollama-embed",
        matchesModel: (m) => modelSet.has(m),
        dimensions: opts.dimensions,
        models: allModels,
        embed: (texts: string[], apiKeys?: UserApiKeys) =>
            embedOpenAICompatible({
                model,
                texts,
                apiKey: apiKey(apiKeys?.openai),
                baseUrl: resolveOpenAIBaseUrl(),
                // No `dimensions`: local backends may reject unknown params.
            }),
    };
}
