import crypto from "crypto";
import { createServerSupabase } from "./supabase";
import type { UserApiKeys } from "./llm";
import { logger } from "./logger";
import {
  API_KEY_PROVIDERS,
  envApiKey,
  hasEnvApiKey,
  normalizeApiKeyProvider,
  type ApiKeyProvider,
  type ApiKeySource,
} from "../core/apiKeyProviders";

type Db = ReturnType<typeof createServerSupabase>;
export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
  sources: Record<ApiKeyProvider, ApiKeySource>;
};

type EncryptedKeyRow = {
  provider: ApiKeyProvider;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  salt?: string | null; // null = legacy row (no HKDF); non-null = HKDF-derived key
};

export { hasEnvApiKey, normalizeApiKeyProvider };

function getMasterSecret(): Buffer {
  const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
  }
  return Buffer.from(secret, "utf8");
}

// Legacy path: SHA-256 of the master secret (single key for all rows).
// Used only to decrypt rows that were written before HKDF was introduced.
function legacyEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(getMasterSecret()).digest();
}

// New path: HKDF (RFC 5869) derives a unique 256-bit key per row using
// a random 16-byte salt. Even if one row's key is somehow extracted, all
// other rows remain secure because their keys are derived with different salts.
function deriveKey(salt: Buffer): Buffer {
  return crypto.hkdfSync(
    "sha256",
    getMasterSecret(),
    salt,
    Buffer.from("mike-user-api-key", "utf8"),
    32,
  );
}

function encrypt(value: string): Omit<EncryptedKeyRow, "provider"> {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted_key: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    salt: salt.toString("base64"),
  };
}

function decrypt(row: EncryptedKeyRow): string | null {
  try {
    // Choose key derivation path based on whether a salt is stored.
    // Rows written before HKDF was introduced have salt = null.
    const key = row.salt
      ? deriveKey(Buffer.from(row.salt, "base64"))
      : legacyEncryptionKey();

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(row.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_key, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    logger.error(
      { provider: row.provider, err },
      "[user-api-keys] failed to decrypt stored key",
    );
    return null;
  }
}

export async function getUserApiKeyStatus(
  userId: string,
  db: Db = createServerSupabase(),
): Promise<ApiKeyStatus> {
  const status: ApiKeyStatus = {
    claude: false,
    gemini: false,
    openai: false,
    sources: {
      claude: null,
      gemini: null,
      openai: null,
    },
  };

  for (const provider of API_KEY_PROVIDERS) {
    if (hasEnvApiKey(provider)) {
      status[provider] = true;
      status.sources[provider] = "env";
    }
  }

  const { data, error } = await db
    .from("user_api_keys")
    .select("provider")
    .eq("user_id", userId);
  if (error) throw error;

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
  db: Db = createServerSupabase(),
): Promise<UserApiKeys> {
  const apiKeys: UserApiKeys = {
    claude: envApiKey("claude"),
    gemini: envApiKey("gemini"),
    openai: envApiKey("openai"),
  };

  const { data, error } = await db
    .from("user_api_keys")
    .select("provider, encrypted_key, iv, auth_tag, salt")
    .eq("user_id", userId);
  if (error) throw error;

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
  db: Db = createServerSupabase(),
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
