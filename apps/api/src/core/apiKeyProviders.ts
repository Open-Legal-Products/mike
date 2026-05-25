export type ApiKeyProvider = string;
export type ApiKeySource = "user" | "env" | null;

type ProviderRecord = {
    readonly envVars: readonly string[];
};

// Table-driven: env-var names live here, not in a switch statement.
// Adding a new provider is one registerApiKeyProvider() call — no edits here.
const _providerRegistry = new Map<string, ProviderRecord>([
    ["claude", { envVars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"] }],
    ["gemini", { envVars: ["GEMINI_API_KEY"] }],
    ["openai", { envVars: ["OPENAI_API_KEY"] }],
]);

/**
 * Register a new API-key provider so that getUserApiKeyStatus() and
 * getUserApiKeys() include it automatically.
 *
 * Call once from your provider setup file alongside registerProvider():
 *
 *   registerApiKeyProvider("bedrock", ["AWS_ACCESS_KEY_ID"]);
 *   registerApiKeyProvider("ollama", []);  // no key required
 */
export function registerApiKeyProvider(
    provider: string,
    envVars: readonly string[],
): void {
    _providerRegistry.set(provider, { envVars });
}

/** Returns provider IDs in registration order. */
export function getRegisteredProviders(): readonly string[] {
    return [..._providerRegistry.keys()];
}

/**
 * @deprecated Use getRegisteredProviders() for dynamic iteration.
 * Kept for backward compatibility — does NOT include providers registered
 * after module load via registerApiKeyProvider().
 */
export const API_KEY_PROVIDERS = ["claude", "gemini", "openai"] as const satisfies readonly string[];

export function isApiKeyProvider(value: string): boolean {
    return _providerRegistry.has(value);
}

export function normalizeApiKeyProvider(value: string): string | null {
    return _providerRegistry.has(value) ? value : null;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

function defaultEnv(): Record<string, string | undefined> {
    return typeof process === "undefined" ? {} : (process.env ?? {});
}

/**
 * Returns the platform API key for provider from environment variables,
 * or null when none of the provider's env vars are set.
 *
 * Table-driven: the env var names are declared in the provider registry above,
 * not hard-coded per-provider in this function body.
 */
export function envApiKey(
    provider: string,
    env: Record<string, string | undefined> = defaultEnv(),
): string | null {
    const record = _providerRegistry.get(provider);
    if (!record) return null;
    for (const varName of record.envVars) {
        const val = env[varName]?.trim();
        if (val) return val;
    }
    return null;
}

export function hasEnvApiKey(
    provider: string,
    env: Record<string, string | undefined> = defaultEnv(),
): boolean {
    return !!envApiKey(provider, env);
}
