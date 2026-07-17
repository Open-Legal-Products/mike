import { logger } from "../../logger";
import { createOpenAIEmbeddingProvider } from "./openai";
import { createGeminiEmbeddingProvider } from "./gemini";
import { createOllamaEmbeddingProvider } from "./providers/ollama";
import {
    registerEmbeddingProvider,
    findEmbeddingProviderForModel,
    type EmbeddingProviderAdapter,
} from "./registry";

export * from "./registry";

// Default embedding model per provider family. The whole deployment pins ONE
// model (EMBEDDING_MODEL) + ONE width (EMBEDDING_DIMENSION) because a vector(N)
// column has a single fixed N; see the migration's header for why.
const DEFAULT_CLOUD_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_LOCAL_EMBEDDING_MODEL = "nomic-embed-text";
const DEFAULT_EMBEDDING_DIMENSION = 768;

/** Column width the adapters emit and the migration pins vector(N) to. */
export function resolveEmbeddingDimension(
    env: NodeJS.ProcessEnv = process.env,
): number {
    const raw = env.EMBEDDING_DIMENSION;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_EMBEDDING_DIMENSION;
}

/**
 * The single embedding model this deployment ingests + searches with. Explicit
 * EMBEDDING_MODEL wins; otherwise air-gapped falls back to the local model
 * (there is no cloud adapter to serve a cloud default), and a normal deployment
 * to the cloud default.
 */
export function resolveEmbeddingModel(
    env: NodeJS.ProcessEnv = process.env,
): string {
    if (env.EMBEDDING_MODEL?.trim()) return env.EMBEDDING_MODEL.trim();
    return env.AIRGAPPED === "true"
        ? DEFAULT_LOCAL_EMBEDDING_MODEL
        : DEFAULT_CLOUD_EMBEDDING_MODEL;
}

/**
 * Register the built-in embedding providers. Mirrors registerBuiltinProviders()
 * in ../index.ts: in air-gapped mode the cloud adapters (OpenAI/Gemini) are NOT
 * registered — semantic search then runs against the local Ollama adapter only,
 * which is the in-code half of the "no external egress" guarantee for RAG.
 *
 * Reads process.env directly (not the validated env) so importing this module
 * doesn't force full env validation — it loads in many unit tests. `env` is
 * injectable so gating can be exercised against a controlled environment.
 */
export function registerBuiltinEmbeddingProviders(
    env: NodeJS.ProcessEnv = process.env,
): void {
    const airgapped = env.AIRGAPPED === "true";
    const dimensions = resolveEmbeddingDimension(env);
    const model = resolveEmbeddingModel(env);

    if (!airgapped) {
        registerEmbeddingProvider(createOpenAIEmbeddingProvider({ dimensions, model }));
        registerEmbeddingProvider(createGeminiEmbeddingProvider({ dimensions, model }));
    } else {
        logger.info(
            "[embeddings] AIRGAPPED=true — cloud embedding providers NOT registered; local only",
        );
    }

    // Local embeddings. Forced in air-gap (the only option); otherwise opt-in
    // via ENABLE_OLLAMA (same flag the chat provider uses).
    if (airgapped || env.ENABLE_OLLAMA === "true") {
        const extraModels = (env.OLLAMA_EMBEDDING_MODELS ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        registerEmbeddingProvider(
            createOllamaEmbeddingProvider({ dimensions, model, extraModels }),
        );
        if (airgapped) {
            logger.info("[embeddings] AIRGAPPED=true — Ollama embedding provider registered");
        }
    }
}

registerBuiltinEmbeddingProviders();

/**
 * Resolve the adapter for the deployment's embedding model, or undefined when
 * none is registered (e.g. air-gapped with no local embedding model configured).
 * Callers degrade gracefully rather than error the chat turn.
 */
export function getActiveEmbeddingProvider(
    env: NodeJS.ProcessEnv = process.env,
): EmbeddingProviderAdapter | undefined {
    return findEmbeddingProviderForModel(resolveEmbeddingModel(env));
}
