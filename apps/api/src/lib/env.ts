import { z } from "zod";

const envSchema = z.object({
    SUPABASE_URL: z.string().min(1, "SUPABASE_URL must be set"),
    SUPABASE_SECRET_KEY: z.string().min(1, "SUPABASE_SECRET_KEY must be set"),
    DOWNLOAD_SIGNING_SECRET: z
        .string()
        .min(
            32,
            "DOWNLOAD_SIGNING_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)",
        ),
    USER_API_KEYS_ENCRYPTION_SECRET: z
        .string()
        .min(
            32,
            "USER_API_KEYS_ENCRYPTION_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)",
        ),

    PORT: z.coerce.number().positive().default(3001),
    NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
    FRONTEND_URL: z.string().default("http://localhost:3000"),
    TRUST_PROXY_HOPS: z.coerce.number().nonnegative().default(1),
    RATE_LIMIT_GENERAL_WINDOW_MINUTES: z.coerce.number().positive().default(15),
    RATE_LIMIT_GENERAL_MAX: z.coerce.number().positive().default(300),
    RATE_LIMIT_CHAT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
    RATE_LIMIT_CHAT_MAX: z.coerce.number().positive().default(30),
    RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES: z.coerce
        .number()
        .positive()
        .default(15),
    RATE_LIMIT_CHAT_CREATE_MAX: z.coerce.number().positive().default(60),
    RATE_LIMIT_UPLOAD_WINDOW_HOURS: z.coerce.number().positive().default(1),
    RATE_LIMIT_UPLOAD_MAX: z.coerce.number().positive().default(50),

    R2_ENDPOINT_URL: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().default("mike"),
    // S3 signing region. "auto" works for Cloudflare R2; other S3-compatible
    // backends need their own value (Supabase Storage → "local", MinIO →
    // "us-east-1", real AWS → the bucket's region).
    R2_REGION: z.string().default("auto"),

    // Google Cloud Storage (optional — set to use GCS instead of R2)
    GCS_BUCKET_NAME: z.string().default("mike"),
    GCS_PROJECT_ID: z.string().optional(),
    // GCS_SIGNED_URL_TTL: signed URL lifetime in seconds (default: 3600)
    GCS_SIGNED_URL_TTL: z.coerce.number().positive().default(3600),

    // Vertex AI (optional — use Gemini via Google Cloud instead of AI Studio)
    VERTEX_AI_PROJECT: z.string().optional(),
    VERTEX_AI_LOCATION: z.string().default("us-central1"),

    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_ALLOW_LOCAL_BASE_URL: z
        .enum(["true", "false"])
        .default("false"),
    GEMINI_API_KEY: z.string().optional(),

    // Local models via Ollama (opt-in). When "true", the Ollama provider is
    // registered at startup (routes its model IDs through the OpenAI-compatible
    // backend at OPENAI_BASE_URL, which for Ollama points at http://…:11434/v1
    // and needs OPENAI_ALLOW_LOCAL_BASE_URL=true). Off by default so cloud
    // deployments' model list and SSRF posture are unaffected. OLLAMA_MODELS is
    // an optional comma-separated list of extra models to register.
    ENABLE_OLLAMA: z.enum(["true", "false"]).default("false"),
    OLLAMA_MODELS: z.string().optional(),
    // Extra local embedding model IDs (comma-separated) to register for the
    // Ollama embedding provider, beyond the built-in defaults (nomic-embed-text …).
    OLLAMA_EMBEDDING_MODELS: z.string().optional(),

    // Air-gapped deployment mode. When "true", the server enforces "no external
    // egress" in code (not just via network isolation): cloud LLM providers
    // (claude/gemini/openai) are NOT registered and their models are refused at
    // the request boundary; only local (Ollama) models are served. Read
    // directly from process.env at startup as well (registerBuiltinProviders)
    // to avoid import-order coupling.
    AIRGAPPED: z.enum(["true", "false"]).default("false"),
    // Local model used when an air-gapped request would otherwise fall back to a
    // cloud default (main chat / title / tabular). Must be a registered Ollama
    // model. Defaults to "llama3.3".
    AIRGAP_DEFAULT_MODEL: z.string().optional(),

    // Quota-accounting failure policy. Credit checks talk to the DB/RPC; when
    // that read fails the request either proceeds (fail-open) or is rejected
    // (fail-closed). Default "false" (fail-open) preserves the historical
    // self-host behavior: a DB hiccup never blocks chat on a non-critical
    // accounting check. Hosted/metered deployments that bill for usage should
    // set this "true" so an unreadable quota denies the request rather than
    // giving away unmetered usage.
    CREDITS_FAIL_CLOSED: z.enum(["true", "false"]).default("false"),

    // Job queue (BullMQ). REDIS_URL points at the Redis instance from
    // docker-compose; defaults to localhost for bare-metal dev.
    REDIS_URL: z.string().default("redis://localhost:6379"),
    // Off by default: when "true", document DOCX→PDF conversion is enqueued to
    // the BullMQ `document-conversion` queue and the upload returns immediately
    // with status "processing" (a worker flips it to "ready"). Requires the
    // frontend to poll document status. When "false" conversion runs inline on
    // the request thread (the historical, synchronous behavior).
    ASYNC_DOCUMENT_CONVERSION: z.enum(["true", "false"]).default("false"),
    // Off by default: when "true", tabular-review cell extraction is enqueued to
    // the BullMQ `tabular-extraction` queue (one job per document) instead of
    // running inline inside the POST /:reviewId/generate SSE request. Extraction
    // then survives client disconnects and server restarts, and failed documents
    // retry with backoff. The /generate request becomes a reconnectable *view*
    // that tails progress over Redis pub/sub (see tabular.generateStream.ts).
    // Requires REDIS_URL. When "false" extraction runs inline (the historical,
    // synchronous behavior that dies with the request).
    ASYNC_TABULAR_EXTRACTION: z.enum(["true", "false"]).default("false"),
    // Off by default: when "true", chunking + embedding of new/replaced document
    // versions is enqueued to the BullMQ `document-embedding` queue so the
    // `search_documents` semantic-search tool has an index to query. When
    // "false" no embeddings are produced and search_documents returns nothing
    // (it degrades gracefully). Requires REDIS_URL and a configured embedding
    // model (EMBEDDING_MODEL / a local Ollama embed model when air-gapped).
    ASYNC_EMBEDDING: z.enum(["true", "false"]).default("false"),
    // The single embedding model used to ingest AND search (they must match).
    // Unset → cloud deployments use text-embedding-3-small; air-gapped uses the
    // local nomic-embed-text. A vector(N) column has ONE fixed width, so the
    // whole deployment pins one model; changing it requires re-embedding
    // (scripts/backfillEmbeddings.ts).
    EMBEDDING_MODEL: z.string().optional(),
    // Embedding vector width. MUST equal the vector(N) in the document_chunks
    // migration (768); adapters request this width where the API supports it.
    EMBEDDING_DIMENSION: z.coerce.number().positive().default(768),

    // Error monitoring (optional). When SENTRY_DSN is unset, Sentry is fully
    // disabled — no SDK init, no network traffic. SENTRY_TRACES_SAMPLE_RATE
    // controls performance tracing (0 = errors only). SENTRY_ENVIRONMENT
    // defaults to NODE_ENV when unset.
    SENTRY_DSN: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
    SENTRY_ENVIRONMENT: z.string().optional(),

    // Distributed tracing via OpenTelemetry (optional). When
    // OTEL_EXPORTER_OTLP_ENDPOINT is unset, tracing is fully disabled — no SDK
    // init, no module patching, no network traffic. Setting it to an OTLP/HTTP
    // collector endpoint turns tracing on. OTEL_ENVIRONMENT labels the
    // deployment.environment resource attribute; defaults to NODE_ENV when
    // unset. NOTE: the actual enable gate is read from process.env directly in
    // lib/observability/otel.ts (init must run before this module loads); these
    // entries exist for validation + documentation.
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_ENVIRONMENT: z.string().optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
    const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = result.data;
