import { z } from "zod";

const envSchema = z.object({
    SUPABASE_URL: z.string().min(1, "SUPABASE_URL must be set"),
    SUPABASE_SECRET_KEY: z.string().min(1, "SUPABASE_SECRET_KEY must be set"),
    DOWNLOAD_SIGNING_SECRET: z
        .string()
        .min(1, "DOWNLOAD_SIGNING_SECRET must be set"),
    USER_API_KEYS_ENCRYPTION_SECRET: z
        .string()
        .min(1, "USER_API_KEYS_ENCRYPTION_SECRET must be set"),

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

    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_ALLOW_LOCAL_BASE_URL: z
        .enum(["true", "false"])
        .default("false"),
    GEMINI_API_KEY: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
    const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = result.data;
