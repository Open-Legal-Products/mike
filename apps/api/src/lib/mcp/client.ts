import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { Agent } from "undici";
import { logger } from "../logger";
import { isBlockedIp } from "../privateIp";
import {
    BLOCKED_METADATA_HOSTS,
    HEADER_NAME_RE,
    MAX_CUSTOM_HEADER_VALUE_LENGTH,
    MAX_CUSTOM_HEADERS,
    type ConnectorRow,
    type Db,
    type McpConnectorAuthConfig,
    type McpConnectorSummary,
    type McpToolSummary,
    type OAuthTokenRow,
    type ToolCacheRow,
} from "./types";

function encryptionSecret(): string {
    const secret =
        process.env.MCP_CONNECTORS_ENCRYPTION_SECRET ||
        process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error(
            "MCP_CONNECTORS_ENCRYPTION_SECRET or USER_API_KEYS_ENCRYPTION_SECRET is not configured",
        );
    }
    return secret;
}

// Legacy path: one scrypt-derived key for every connector secret (static salt).
// Kept only to decrypt rows written before per-row HKDF was introduced.
function legacyEncryptionKey(): Buffer {
    return crypto.scryptSync(encryptionSecret(), "mike-user-mcp-v1", 32);
}

// New path: HKDF (RFC 5869) derives a unique 256-bit key per secret from a random
// 16-byte salt, matching the per-row scheme used for user API keys. One key's
// compromise no longer exposes every other connector secret.
function deriveKey(salt: Buffer): Buffer {
    return Buffer.from(
        crypto.hkdfSync(
            "sha256",
            Buffer.from(encryptionSecret(), "utf8"),
            salt,
            Buffer.from("mike-user-mcp-v2", "utf8"),
            32,
        ),
    );
}

// The salt has to travel with the ciphertext, but the connector tables have no
// salt column. Rather than a migration across four encrypted fields, pack it
// into the stored value: `v2.` + base64(salt(16) || ciphertext). A wrong/forged
// salt derives a wrong key, so GCM auth fails closed on decrypt. Legacy rows
// have no `v2.` prefix and decrypt with the static key.
const V2_PREFIX = "v2.";

function packCiphertext(salt: Buffer, ciphertext: Buffer): string {
    return V2_PREFIX + Buffer.concat([salt, ciphertext]).toString("base64");
}

// Resolve stored ciphertext to the key that decrypts it and the raw bytes.
function unpackCiphertext(stored: string): { key: Buffer; data: Buffer } {
    if (stored.startsWith(V2_PREFIX)) {
        const buf = Buffer.from(stored.slice(V2_PREFIX.length), "base64");
        return {
            key: deriveKey(buf.subarray(0, 16)),
            data: buf.subarray(16),
        };
    }
    return { key: legacyEncryptionKey(), data: Buffer.from(stored, "base64") };
}

export function mcpOAuthCallbackUrl() {
    const base = (
        process.env.API_PUBLIC_URL ||
        process.env.BACKEND_URL ||
        `http://localhost:${process.env.PORT ?? "3001"}`
    ).replace(/\/+$/, "");
    return `${base}/user/mcp-connectors/oauth/callback`;
}

function encryptJson(value: Record<string, unknown>): {
    encrypted_auth_config: string;
    auth_config_iv: string;
    auth_config_tag: string;
} {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(salt), iv);
    const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted_auth_config: packCiphertext(salt, encrypted),
        auth_config_iv: iv.toString("base64"),
        auth_config_tag: cipher.getAuthTag().toString("base64"),
    };
}

export function encryptString(value: string): {
    encrypted: string;
    iv: string;
    tag: string;
} {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(salt), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted: packCiphertext(salt, encrypted),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
}

export function decryptString(
    encrypted: string | null | undefined,
    iv: string | null | undefined,
    tag: string | null | undefined,
): string | null {
    if (!encrypted || !iv || !tag) return null;
    try {
        const { key, data } = unpackCiphertext(encrypted);
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(data),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        logger.error(
            {
                error: err instanceof Error ? err.message : String(err),
            },
            "[mcp-connectors] failed to decrypt string secret",
        );
        return null;
    }
}

export function decryptAuthConfig(row: ConnectorRow): McpConnectorAuthConfig {
    if (
        !row.encrypted_auth_config ||
        !row.auth_config_iv ||
        !row.auth_config_tag
    ) {
        return {};
    }
    try {
        const { key, data } = unpackCiphertext(row.encrypted_auth_config);
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(row.auth_config_iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(row.auth_config_tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(data),
            decipher.final(),
        ]);
        const parsed = JSON.parse(decrypted.toString("utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as McpConnectorAuthConfig)
            : {};
    } catch (err) {
        logger.error(
            {
                connectorId: row.id,
                error: err instanceof Error ? err.message : String(err),
            },
            "[mcp-connectors] failed to decrypt auth config",
        );
        return {};
    }
}

function sanitizeToolPart(value: string, fallback: string, maxLength: number) {
    const sanitized = value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
    return (sanitized || fallback).slice(0, maxLength);
}

export function openaiToolName(connector: ConnectorRow, toolName: string) {
    const connectorSlug = sanitizeToolPart(connector.name, "connector", 18);
    const toolSlug = sanitizeToolPart(toolName, "tool", 30);
    const idSlug = connector.id.replace(/-/g, "").slice(0, 8);
    return `mcp_${connectorSlug}_${toolSlug}_${idSlug}`;
}

export function normalizeJsonSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return { type: "object", properties: {} };
    }
    const out = { ...(schema as Record<string, unknown>) };
    if (out.type !== "object") out.type = "object";
    if (!out.properties || typeof out.properties !== "object") {
        out.properties = {};
    }
    return out;
}

function truthyAnnotation(
    annotations: Record<string, unknown> | null | undefined,
    key: string,
) {
    return annotations?.[key] === true;
}

export function toolRequiresConfirmation(
    annotations: Record<string, unknown> | null | undefined,
) {
    // Gate only genuinely destructive tools behind human confirmation. We do
    // NOT gate on openWorldHint (almost every useful connector — Gmail, Slack,
    // GitHub — is "open world", so gating on it disables everything), and we
    // require readOnlyHint to be *explicitly* false rather than merely absent
    // (a missing hint must not be treated the same as readOnlyHint:false).
    return (
        truthyAnnotation(annotations, "destructiveHint") ||
        annotations?.readOnlyHint === false
    );
}

function toToolSummary(row: ToolCacheRow): McpToolSummary {
    return {
        id: row.id,
        toolName: row.tool_name,
        openaiToolName: row.openai_tool_name,
        title: row.title,
        description: row.description,
        enabled: row.enabled,
        readOnly: truthyAnnotation(row.annotations, "readOnlyHint"),
        destructive: truthyAnnotation(row.annotations, "destructiveHint"),
        requiresConfirmation: row.requires_confirmation,
        lastSeenAt: row.last_seen_at,
    };
}

export function toConnectorSummary(
    connector: ConnectorRow,
    tools: ToolCacheRow[] = [],
    oauthToken?: OAuthTokenRow | null,
    toolCount = tools.length,
): McpConnectorSummary {
    const authConfig = decryptAuthConfig(connector);
    return {
        id: connector.id,
        name: connector.name,
        transport: connector.transport,
        serverUrl: connector.server_url,
        authType: connector.auth_type ?? "none",
        enabled: connector.enabled,
        hasAuthConfig: !!connector.encrypted_auth_config,
        customHeaderKeys: Object.keys(authConfig.headers ?? {}),
        oauthConnected: !!oauthToken?.encrypted_access_token,
        toolPolicy: connector.tool_policy ?? {},
        tools: tools.map(toToolSummary),
        toolCount,
        createdAt: connector.created_at,
        updatedAt: connector.updated_at,
    };
}

// Private/reserved IP classification lives in lib/privateIp.ts so the OpenAI
// base-URL SSRF check reuses the exact same ranges.

export async function validateRemoteMcpUrl(rawUrl: string): Promise<string> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error("MCP server URL must be a valid URL.");
    }
    if (url.protocol !== "https:") {
        throw new Error("MCP server URL must use HTTPS.");
    }
    url.username = "";
    url.password = "";
    url.hash = "";

    const hostname = url.hostname.toLowerCase();
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        BLOCKED_METADATA_HOSTS.has(hostname)
    ) {
        throw new Error("MCP server URL points to a blocked host.");
    }

    // URL.hostname wraps IPv6 literals in brackets ("[::1]"), which net.isIP
    // does not recognize. Strip them so an IPv6 literal is classified by the
    // private-IP guard rather than falling through to a DNS lookup that would
    // treat the bracketed form as an (unresolvable) hostname.
    const literalHost =
        hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;
    const literalFamily = net.isIP(literalHost);
    const addresses = literalFamily
        ? [{ address: literalHost }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) {
        throw new Error("MCP server URL resolves to a blocked network address.");
    }

    return url.toString();
}

export function headersForAuth(config: McpConnectorAuthConfig) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.headers ?? {})) {
        if (typeof value === "string" && key.toLowerCase() !== "host") {
            headers[key] = value;
        }
    }
    if (config.bearerToken?.trim()) {
        headers.Authorization = `Bearer ${config.bearerToken.trim()}`;
    }
    return headers;
}

export function validateCustomHeaders(
    raw: Record<string, unknown> | undefined,
): Record<string, string> {
    if (!raw) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Custom headers must be an object.");
    }
    const entries = Object.entries(raw);
    if (entries.length > MAX_CUSTOM_HEADERS) {
        throw new Error(`Custom headers may not exceed ${MAX_CUSTOM_HEADERS} entries.`);
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of entries) {
        const trimmedKey = key.trim();
        if (!HEADER_NAME_RE.test(trimmedKey) || trimmedKey.toLowerCase() === "host") {
            throw new Error(`Invalid custom header name: ${key}`);
        }
        if (
            typeof value !== "string" ||
            value.length > MAX_CUSTOM_HEADER_VALUE_LENGTH
        ) {
            throw new Error(
                `Custom header ${key} must be a string of ${MAX_CUSTOM_HEADER_VALUE_LENGTH} characters or fewer.`,
            );
        }
        headers[trimmedKey] = value;
    }
    return headers;
}

export function authConfigPatch(config: McpConnectorAuthConfig): Record<string, unknown> {
    const hasBearer = !!config.bearerToken?.trim();
    const hasHeaders = Object.keys(config.headers ?? {}).length > 0;
    if (!hasBearer && !hasHeaders) {
        return {
            encrypted_auth_config: null,
            auth_config_iv: null,
            auth_config_tag: null,
        };
    }
    return encryptJson({
        ...(hasBearer ? { bearerToken: config.bearerToken?.trim() } : {}),
        ...(hasHeaders ? { headers: config.headers } : {}),
    });
}

// A per-request undici dispatcher whose DNS lookup runs the private-IP guard at
// the moment the socket is opened and returns ONLY validated addresses. Because
// undici connects to exactly what this lookup yields, the address we validate is
// the address we connect to — there is no second, unguarded resolution for an
// attacker to race (DNS-rebinding / TOCTOU). The URL hostname is untouched, so
// the Host header and TLS SNI still reflect the real host and HTTPS verifies
// normally against legitimate public servers.
function pinnedGuardAgent(): Agent {
    return new Agent({
        connect: {
            lookup: (hostname, _options, callback) => {
                dns.lookup(hostname, { all: true, verbatim: true })
                    .then((addresses) => {
                        if (
                            !addresses.length ||
                            addresses.some(({ address }) => isBlockedIp(address))
                        ) {
                            callback(
                                new Error(
                                    "MCP server URL resolves to a blocked network address.",
                                ),
                                [],
                            );
                            return;
                        }
                        callback(null, addresses);
                    })
                    .catch((err: unknown) =>
                        callback(
                            err instanceof Error ? err : new Error(String(err)),
                            [],
                        ),
                    );
            },
        },
    });
}

// The single guarded egress helper for every outbound MCP request (connector
// transport, OAuth discovery/registration/refresh). It rejects non-HTTPS,
// credentialed, metadata-host and private-IP-literal URLs up front, pins the
// connection to a connect-time-validated address, and refuses to auto-follow
// redirects (`redirect: "manual"`) so a 3xx to an internal host cannot smuggle
// egress past the guard.
export async function guardedFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
) {
    const url =
        typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
    await validateRemoteMcpUrl(url);
    return fetch(input, {
        ...init,
        redirect: "manual",
        dispatcher: pinnedGuardAgent(),
    } as RequestInit);
}

export function base64Url(buffer: Buffer) {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function sha256Base64Url(value: string) {
    return base64Url(crypto.createHash("sha256").update(value).digest());
}

export function stateHash(state: string) {
    return crypto.createHash("sha256").update(state).digest("hex");
}

export async function loadConnector(
    userId: string,
    connectorId: string,
    db: Db,
): Promise<ConnectorRow> {
    const { data, error } = await db
        .from("user_mcp_connectors")
        .select("*")
        .eq("user_id", userId)
        .eq("id", connectorId)
        .single();
    if (error) throw error;
    return data as ConnectorRow;
}
