import type { UserApiKeys } from "../types";
import type { EmbeddingProviderAdapter } from "./registry";

// Reuse the same dynamic-ESM import shim the chat adapter uses so @google/genai
// (an ESM-only package) loads from CommonJS without TS rewriting the import.
type GoogleGenAIConstructor = typeof import("@google/genai").GoogleGenAI;
type GoogleGenAIClient = InstanceType<GoogleGenAIConstructor>;

const importEsm = new Function("specifier", "return import(specifier)") as (
    specifier: string,
) => Promise<{ GoogleGenAI: GoogleGenAIConstructor }>;

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "Gemini API key is not configured. Set GEMINI_API_KEY or add a user Gemini key.",
        );
    }
    return key;
}

async function client(override?: string | null): Promise<GoogleGenAIClient> {
    const { GoogleGenAI } = await importEsm("@google/genai");
    return new GoogleGenAI({ apiKey: apiKey(override) });
}

export const GEMINI_EMBEDDING_MODELS = [
    "text-embedding-004",
    "gemini-embedding-001",
] as const;

type EmbedContentResponse = {
    embeddings?: { values?: number[] }[];
    embedding?: { values?: number[] };
};

/**
 * Build the cloud Gemini embedding adapter, bound to the deployment's single
 * embedding model. text-embedding-004 is natively 768-dim; gemini-embedding-001
 * accepts an outputDimensionality, so we request the column width either way.
 */
export function createGeminiEmbeddingProvider(opts: {
    dimensions: number;
    model?: string;
}): EmbeddingProviderAdapter {
    const modelSet = new Set<string>(GEMINI_EMBEDDING_MODELS);
    const model =
        opts.model && modelSet.has(opts.model)
            ? opts.model
            : GEMINI_EMBEDDING_MODELS[0];
    return {
        id: "gemini-embed",
        matchesModel: (m) => modelSet.has(m),
        dimensions: opts.dimensions,
        models: GEMINI_EMBEDDING_MODELS,
        embed: async (texts: string[], apiKeys?: UserApiKeys) => {
            if (texts.length === 0) return [];
            const ai = await client(apiKeys?.gemini);
            const res = (await ai.models.embedContent({
                model,
                contents: texts,
                config: { outputDimensionality: opts.dimensions },
            })) as EmbedContentResponse;
            // Batch response: one embedding per input, in input order.
            if (Array.isArray(res.embeddings)) {
                return res.embeddings.map((e) => e.values ?? []);
            }
            // Defensive: single-content shape.
            return res.embedding?.values ? [res.embedding.values] : [];
        },
    };
}
