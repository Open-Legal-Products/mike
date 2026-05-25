export type ApiKeyProvider = "claude" | "gemini" | "openai";
export type ApiKeySource = "user" | "env" | null;

declare const process: { env?: Record<string, string | undefined> } | undefined;

function defaultEnv(): Record<string, string | undefined> {
    return typeof process === "undefined" ? {} : (process.env ?? {});
}

export const API_KEY_PROVIDERS = [
    "claude",
    "gemini",
    "openai",
] as const satisfies readonly ApiKeyProvider[];

export function isApiKeyProvider(value: string): value is ApiKeyProvider {
    return (API_KEY_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null {
    return isApiKeyProvider(value) ? value : null;
}

export function envApiKey(
    provider: ApiKeyProvider,
    env: Record<string, string | undefined> = defaultEnv(),
): string | null {
    if (provider === "claude") {
        return (
            env.ANTHROPIC_API_KEY?.trim() || env.CLAUDE_API_KEY?.trim() || null
        );
    }
    if (provider === "openai") {
        return env.OPENAI_API_KEY?.trim() || null;
    }
    return env.GEMINI_API_KEY?.trim() || null;
}

export function hasEnvApiKey(
    provider: ApiKeyProvider,
    env: Record<string, string | undefined> = defaultEnv(),
): boolean {
    return !!envApiKey(provider, env);
}
