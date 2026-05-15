import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db";
import { user_api_keys } from "../db/schema";
import type { UserApiKeys } from "./llm";

// Claude is served by Bedrock with IAM creds, so user-supplied Claude keys
// are no longer accepted. Per-user keys remain for Gemini and OpenAI only.
export type ApiKeyProvider = "gemini" | "openai";
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

const PROVIDERS: ApiKeyProvider[] = ["gemini", "openai"];

function envApiKey(provider: ApiKeyProvider): string | null {
    if (provider === "openai") {
        return process.env.OPENAI_API_KEY?.trim() || null;
    }
    return process.env.GEMINI_API_KEY?.trim() || null;
}

export function hasEnvApiKey(provider: ApiKeyProvider): boolean {
    return !!envApiKey(provider);
}

function encryptionKey(): Buffer {
    const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error(
            "USER_API_KEYS_ENCRYPTION_SECRET is required to read/write user-stored API keys",
        );
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
    client: Db = defaultDb,
): Promise<ApiKeyStatus> {
    const status: ApiKeyStatus = {
        gemini: false,
        openai: false,
        sources: {
            gemini: null,
            openai: null,
        },
    };

    for (const provider of PROVIDERS) {
        if (hasEnvApiKey(provider)) {
            status[provider] = true;
            status.sources[provider] = "env";
        }
    }

    const rows = await client
        .select({ provider: user_api_keys.provider })
        .from(user_api_keys)
        .where(eq(user_api_keys.user_id, userId));

    for (const row of rows) {
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
    client: Db = defaultDb,
): Promise<UserApiKeys> {
    const apiKeys: UserApiKeys = {
        gemini: envApiKey("gemini"),
        openai: envApiKey("openai"),
    };

    const rows = await client
        .select({
            provider: user_api_keys.provider,
            encrypted_key: user_api_keys.encrypted_key,
            iv: user_api_keys.iv,
            auth_tag: user_api_keys.auth_tag,
        })
        .from(user_api_keys)
        .where(eq(user_api_keys.user_id, userId));

    for (const row of rows) {
        const provider = normalizeApiKeyProvider(row.provider);
        if (!provider) continue;
        if (apiKeys[provider]?.trim()) continue;
        apiKeys[provider] = decrypt(row as EncryptedKeyRow);
    }

    return apiKeys;
}

export async function saveUserApiKey(
    userId: string,
    provider: ApiKeyProvider,
    value: string | null,
    client: Db = defaultDb,
): Promise<void> {
    const normalized = value?.trim() || null;
    if (!normalized) {
        await client
            .delete(user_api_keys)
            .where(
                and(
                    eq(user_api_keys.user_id, userId),
                    eq(user_api_keys.provider, provider),
                ),
            );
        return;
    }

    const enc = encrypt(normalized);
    await client
        .insert(user_api_keys)
        .values({
            user_id: userId,
            provider,
            encrypted_key: enc.encrypted_key,
            iv: enc.iv,
            auth_tag: enc.auth_tag,
            updated_at: new Date(),
        })
        .onConflictDoUpdate({
            target: [user_api_keys.user_id, user_api_keys.provider],
            set: {
                encrypted_key: enc.encrypted_key,
                iv: enc.iv,
                auth_tag: enc.auth_tag,
                updated_at: new Date(),
            },
        });
}
