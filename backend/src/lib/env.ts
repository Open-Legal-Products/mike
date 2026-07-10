import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production";

function requiredInProd<T extends z.ZodTypeAny>(schema: T) {
  return isProduction ? schema : schema.optional();
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  // Core secrets
  DOWNLOAD_SIGNING_SECRET: z
    .string()
    .min(32, "DOWNLOAD_SIGNING_SECRET must be at least 32 characters")
    .refine((v) => !v.startsWith("replace-"), {
      message: "DOWNLOAD_SIGNING_SECRET is using a placeholder value",
    }),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(32, "SUPABASE_SECRET_KEY must be a valid service-role key")
    .refine((v) => !v.startsWith("your-") && !v.includes("GENERATED"), {
      message: "SUPABASE_SECRET_KEY is using a placeholder value",
    }),

  // S3-compatible storage (S3_* preferred; R2_* legacy fallback)
  S3_ENDPOINT_URL: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET_NAME: z.string().min(1).default("mike"),
  S3_REGION: z.string().min(1).default("us-east-1"),

  // Legacy R2 variables (optional; used only if S3_* are absent)
  R2_ENDPOINT_URL: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).default("mike"),

  // LLM providers: at least one is required for chat features
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),

  // Email
  RESEND_API_KEY: z.string().min(1).optional(),

  // Per-user provider key encryption
  USER_API_KEYS_ENCRYPTION_SECRET: z
    .string()
    .min(32)
    .refine((v) => !v.startsWith("your-"), {
      message: "USER_API_KEYS_ENCRYPTION_SECRET is using a placeholder value",
    }),

  // Optional: US case-law lookup
  COURTLISTENER_API_TOKEN: z.string().min(1).optional(),

  // Optional: commit SHA exposed by /health
  COMMIT_SHA: z.string().min(1).optional(),

  // Optional: raw LLM stream logging (security risk — disabled by default)
  LOG_RAW_LLM_STREAM: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  RAW_LLM_STREAM_LOG_DIR: z.string().optional(),

  // Optional: LibreOffice binary path override
  SOFFICE_BINARY_PATH: z.string().optional(),
  LIBREOFFICE_BINARY_PATH: z.string().optional(),
  LIBRE_OFFICE_EXE: z.string().optional(),

  // Rate limits
  RATE_LIMIT_GENERAL_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_CHAT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_CHAT_CREATE_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_UPLOAD_WINDOW_HOURS: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_EXPORT_WINDOW_HOURS: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_EXPORT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_DATA_DELETE_WINDOW_HOURS: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_DATA_DELETE_MAX: z.coerce.number().int().positive().default(20),

  // Proxy trust
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),
}).refine(
  (data) => {
    const hasS3 = Boolean(
      data.S3_ENDPOINT_URL && data.S3_ACCESS_KEY_ID && data.S3_SECRET_ACCESS_KEY,
    );
    const hasR2 = Boolean(
      data.R2_ENDPOINT_URL && data.R2_ACCESS_KEY_ID && data.R2_SECRET_ACCESS_KEY,
    );
    return hasS3 || hasR2;
  },
  {
    message:
      "Storage credentials are required. Provide S3_ENDPOINT_URL, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (preferred) or the legacy R2_* equivalents.",
    path: ["S3_ENDPOINT_URL"],
  },
).refine(
  (data) => {
    if (data.NODE_ENV !== "production") return true;
    return !data.LOG_RAW_LLM_STREAM && !data.RAW_LLM_STREAM_LOG_DIR;
  },
  {
    message:
      "RAW_LLM_STREAM_LOG_DIR and LOG_RAW_LLM_STREAM are prohibited in production because they may leak prompts and documents.",
    path: ["LOG_RAW_LLM_STREAM"],
  },
);

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function validateEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  const env = parsed.data;

  const hasAnyProviderKey = [
    env.ANTHROPIC_API_KEY,
    env.CLAUDE_API_KEY,
    env.GEMINI_API_KEY,
    env.OPENAI_API_KEY,
    env.OPENROUTER_API_KEY,
  ].some(Boolean);

  if (!hasAnyProviderKey) {
    // Warn but do not fail: local development can run without an LLM provider.
    console.warn(
      "[env] No LLM provider key configured. Chat features will fail until ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY is set.",
    );
  }

  if (env.LOG_RAW_LLM_STREAM) {
    console.warn(
      "[env] LOG_RAW_LLM_STREAM is enabled. This may write prompts and completions to disk. Never enable this in production or with real documents.",
    );
  }

  if (!isProduction) {
    console.warn("[env] Running in development mode. Do not use real client data.");
  }

  cachedEnv = env;
  return env;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return validateEnv();
  }
  return cachedEnv;
}
