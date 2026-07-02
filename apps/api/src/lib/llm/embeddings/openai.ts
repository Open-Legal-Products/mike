import type { UserApiKeys } from "../types";
import { resolveOpenAIBaseUrl } from "../baseUrl";
import type { EmbeddingProviderAdapter } from "./registry";

/**
 * OpenAI-compatible `/v1/embeddings` client, shared by the cloud OpenAI adapter
 * and the local Ollama adapter (Ollama exposes the same endpoint on :11434/v1).
 *
 * The base URL is resolved through resolveOpenAIBaseUrl(), which is the same
 * SSRF/air-gap guard the chat adapter uses — so in air-gapped mode this cannot
 * leak egress: OPENAI_BASE_URL must already point at a local/internal host.
 */
export async function embedOpenAICompatible(params: {
    model: string;
    texts: string[];
    apiKey: string;
    baseUrl: string;
    /** Requested output width; omitted for backends that don't support it. */
    dimensions?: number;
}): Promise<number[][]> {
    if (params.texts.length === 0) return [];
    const response = await fetch(`${params.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${params.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: params.model,
            input: params.texts,
            dimensions: params.dimensions,
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(
            `Embedding request failed (${response.status}): ${text || response.statusText}`,
        );
        (err as { status?: number }).status = response.status;
        throw err;
    }
    const json = (await response.json()) as {
        data?: { embedding?: number[]; index?: number }[];
    };
    const rows = json.data ?? [];
    // The API returns entries with an explicit `index`; sort by it so the output
    // order matches the input order even if the server reorders.
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((r) => r.embedding ?? []);
}

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "OpenAI API key is not configured. Set OPENAI_API_KEY or add a user OpenAI key.",
        );
    }
    return key;
}

export const OPENAI_EMBEDDING_MODELS = [
    "text-embedding-3-small",
    "text-embedding-3-large",
] as const;

/**
 * Build the cloud OpenAI embedding adapter, bound to the deployment's single
 * embedding model (see registerBuiltinEmbeddingProviders). `dimensions` is
 * passed through to the API — the text-embedding-3-* models support Matryoshka
 * truncation, so we ask for exactly the column width (default 768) and every
 * stored row stays uniform. Binding one model per deployment is deliberate: a
 * vector(N) column has one fixed width, so mixing models is unsafe.
 */
export function createOpenAIEmbeddingProvider(opts: {
    dimensions: number;
    model?: string;
}): EmbeddingProviderAdapter {
    const modelSet = new Set<string>(OPENAI_EMBEDDING_MODELS);
    const model =
        opts.model && modelSet.has(opts.model)
            ? opts.model
            : OPENAI_EMBEDDING_MODELS[0];
    return {
        id: "openai-embed",
        matchesModel: (m) => modelSet.has(m),
        dimensions: opts.dimensions,
        models: OPENAI_EMBEDDING_MODELS,
        embed: (texts: string[], apiKeys?: UserApiKeys) =>
            embedOpenAICompatible({
                model,
                texts,
                apiKey: apiKey(apiKeys?.openai),
                baseUrl: resolveOpenAIBaseUrl(),
                dimensions: opts.dimensions,
            }),
    };
}
