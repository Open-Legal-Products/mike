import crypto from "crypto";
import { createDb, DbClient } from "./db";
import type { UserApiKeys } from "./llm";

type Db = DbClient;
export type ApiKeyProvider = "claude" | "gemini" | "openai" | "ollama";
export type ApiKeySource = "user" | "env" | null;
export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources: Record<ApiKeyProvider, ApiKeySource>;
};

type EncryptedKeyRow = {
    provider: ApiKeyProvider;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
};

const PROVIDERS: ApiKeyProvider[] = ["claude", "gemini", "openai", "ollama"];

function envApiKey(provider: ApiKeyProvider): string | null {
    if (provider === "claude") {
        return (
            process.env.ANTHROPIC_API_KEY?.trim() ||
            process.env.CLAUDE_API_KEY?.trim() ||
            null
        );
    }
    if (provider === "openai") {
        return process.env.OPENAI_API_KEY?.trim() || null;
    }
    if (provider === "ollama") {
        return process.env.OLLAMA_API_KEY?.trim() ||
               process.env.LLAMACPP_API_KEY?.trim() ||
               null;
    }
    return process.env.GEMINI_API_KEY?.trim() || null;
}

/**
 * Returns true if the Ollama provider is available via env config
 * (either OLLAMA_BASE_URL or an API key).  Used separately from
 * envApiKey because Ollama may not require an API key at all.
 */
export function hasEnvOllama(): boolean {
    return !!(
        process.env.OLLAMA_API_KEY?.trim() ||
        process.env.LLAMACPP_API_KEY?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim() ||
        process.env.LLAMACPP_BASE_URL?.trim()
    );
}

export function hasEnvApiKey(provider: ApiKeyProvider): boolean {
    return !!envApiKey(provider);
}

function encryptionKey(): Buffer {
    const secret =
        process.env.USER_API_KEYS_ENCRYPTION_SECRET ||
        process.env.API_KEYS_ENCRYPTION_SECRET ||
        process.env.JWT_SECRET ||
        process.env.SUPABASE_SECRET_KEY;
    if (!secret) {
        throw new Error("API key encryption secret is not configured");
    }
    return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string): Omit<EncryptedKeyRow, "provider"> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted_key: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        auth_tag: cipher.getAuthTag().toString("base64"),
    };
}

function decrypt(row: EncryptedKeyRow): string | null {
    try {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            encryptionKey(),
            Buffer.from(row.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(row.encrypted_key, "base64")),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        console.error("[user-api-keys] failed to decrypt stored key", {
            provider: row.provider,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

function isProvider(value: string): value is ApiKeyProvider {
    return (PROVIDERS as string[]).includes(value);
}

export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null {
    return isProvider(value) ? value : null;
}

export async function getUserApiKeyStatus(
    userId: string,
    db: Db = createDb(),
): Promise<ApiKeyStatus> {
    const status: ApiKeyStatus = {
        claude: false,
        gemini: false,
        openai: false,
        ollama: false,
        sources: {
            claude: null,
            gemini: null,
            openai: null,
            ollama: null,
        },
    };

    for (const provider of PROVIDERS) {
        // Ollama is available via env if the base URL or API key is set,
        // even if no actual API key is provided.
        if (provider === "ollama") {
            if (hasEnvOllama()) {
                status[provider] = true;
                status.sources[provider] = "env";
            }
        } else if (hasEnvApiKey(provider)) {
            status[provider] = true;
            status.sources[provider] = "env";
        }
    }

    const { data } = await db
        .from("user_api_keys")
        .select("provider")
        .eq("user_id", userId);

    for (const row of data ?? []) {
        const provider = normalizeApiKeyProvider(String(row.provider));
        if (provider && !status[provider]) {
            status[provider] = true;
            status.sources[provider] = "user";
        }
    }

    return status;
}

export async function getUserApiKeys(
    userId: string,
    db: Db = createDb(),
): Promise<UserApiKeys> {
    const apiKeys: UserApiKeys = {
        claude: envApiKey("claude"),
        gemini: envApiKey("gemini"),
        openai: envApiKey("openai"),
        ollama: envApiKey("ollama"),
    };

    const { data } = await db
        .from("user_api_keys")
        .select("provider, encrypted_key, iv, auth_tag")
        .eq("user_id", userId);

    for (const row of (data ?? []) as EncryptedKeyRow[]) {
        const provider = normalizeApiKeyProvider(row.provider);
        if (!provider) continue;
        if (apiKeys[provider]?.trim()) continue;
        apiKeys[provider] = decrypt(row);
    }

    return apiKeys;
}

export async function saveUserApiKey(
    userId: string,
    provider: ApiKeyProvider,
    value: string | null,
    db: Db = createDb(),
): Promise<void> {
    const normalized = value?.trim() || null;

    if (!normalized) {
        const { error } = await db
            .from("user_api_keys")
            .delete()
            .eq("user_id", userId)
            .eq("provider", provider);
        if (error) throw error;
        return;
    }

    const { error } = await db.from("user_api_keys").upsert(
        {
            user_id: userId,
            provider,
            ...encrypt(normalized),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
    );
    if (error) throw error;
}
