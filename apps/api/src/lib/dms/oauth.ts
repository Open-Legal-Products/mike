/**
 * DMS OAuth2 (authorization-code + refresh) provider.
 *
 * Structurally this mirrors lib/mcp/oauth.ts — encrypted token storage, a
 * 60-second refresh skew, and a hashed one-time state row — but iManage and
 * NetDocuments both expose standard, fixed OAuth endpoints (no MCP dynamic
 * discovery / dynamic client registration), so the flow is a direct auth-code
 * exchange rather than driven by the MCP SDK. Every token endpoint request goes
 * through the SSRF-guarded `guardedFetch`.
 *
 * LIVE TENANT VALIDATION REQUIRED: the per-vendor authorize/token endpoint
 * paths below are best-effort from public docs and are proven only against the
 * mocked HTTP in __tests__/oauth.test.ts. Real tenants need OAuth client
 * credentials (IMANAGE_/NETDOCS_OAUTH_CLIENT_ID/SECRET/SCOPE) and the correct
 * tenant base URL; confirming the endpoints is an operator acceptance step.
 */
import crypto from "crypto";
import { base64Url, guardedFetch, stateHash } from "../mcp/client";
import { logger } from "../logger";
import { createServerSupabase } from "../supabase";
import { decryptString, encryptString } from "./crypto";
import {
    OAUTH_EXPIRY_SKEW_MS,
    OAUTH_STATE_TTL_MS,
    type Db,
    type DmsConnectorRow,
    type DmsOAuthTokenRow,
} from "./types";
import type { DmsKind } from "./adapter";

export class DmsOAuthRequiredError extends Error {
    code = "oauth_required";
    constructor(message = "OAuth authorization is required for this DMS connector.") {
        super(message);
        this.name = "DmsOAuthRequiredError";
    }
}

export function dmsOAuthCallbackUrl(): string {
    const base = (
        process.env.API_PUBLIC_URL ||
        process.env.BACKEND_URL ||
        `http://localhost:${process.env.PORT ?? "3001"}`
    ).replace(/\/+$/, "");
    return `${base}/user/dms-connectors/oauth/callback`;
}

/**
 * Per-vendor authorize + token endpoints, derived from the tenant base URL.
 * These are the documented defaults; a deployment can override them per
 * connector via the `config` jsonb (authorization_endpoint / token_endpoint).
 */
function oauthEndpoints(
    kind: DmsKind,
    baseUrl: string,
    config: Record<string, unknown> | null,
): { authorizationEndpoint: string; tokenEndpoint: string } {
    const base = baseUrl.replace(/\/+$/, "");
    const override = (key: string) =>
        typeof config?.[key] === "string" ? (config[key] as string) : null;
    if (kind === "imanage") {
        return {
            authorizationEndpoint:
                override("authorization_endpoint") ??
                `${base}/auth/oauth2/authorize`,
            tokenEndpoint:
                override("token_endpoint") ?? `${base}/auth/oauth2/token`,
        };
    }
    // NetDocuments
    return {
        authorizationEndpoint:
            override("authorization_endpoint") ?? `${base}/v1/OAuth`,
        tokenEndpoint: override("token_endpoint") ?? `${base}/v1/OAuth/token`,
    };
}

/**
 * OAuth client credentials, read from process.env directly (like mcp/oauth) so
 * they resolve at call time rather than at env-module load.
 */
export function dmsOAuthClientEnv(kind: DmsKind): {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
} {
    const prefix = kind === "imanage" ? "IMANAGE_OAUTH" : "NETDOCS_OAUTH";
    return {
        clientId: process.env[`${prefix}_CLIENT_ID`],
        clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
        scope: process.env[`${prefix}_SCOPE`],
    };
}

export async function loadDmsConnector(
    userId: string,
    connectorId: string,
    db: Db,
): Promise<DmsConnectorRow> {
    const { data, error } = await db
        .from("dms_connectors")
        .select("*")
        .eq("user_id", userId)
        .eq("id", connectorId)
        .single();
    if (error) throw error;
    return data as DmsConnectorRow;
}

export async function loadDmsOAuthToken(
    connectorId: string,
    db: Db,
): Promise<DmsOAuthTokenRow | null> {
    const { data, error } = await db
        .from("dms_connector_oauth_tokens")
        .select("*")
        .eq("connector_id", connectorId)
        .maybeSingle();
    if (error) throw error;
    return (data as DmsOAuthTokenRow | null) ?? null;
}

function secretPatch(prefix: string, value?: string | null) {
    if (!value) {
        return {
            [`encrypted_${prefix}`]: null,
            [`${prefix}_iv`]: null,
            [`${prefix}_tag`]: null,
        };
    }
    const enc = encryptString(value);
    return {
        [`encrypted_${prefix}`]: enc.encrypted,
        [`${prefix}_iv`]: enc.iv,
        [`${prefix}_tag`]: enc.tag,
    };
}

async function storeToken(
    connectorId: string,
    ctx: {
        authorizationServer: string;
        tokenEndpoint: string;
        clientId: string;
        clientSecret?: string;
        scope?: string;
        resource?: string;
    },
    token: Record<string, unknown>,
    db: Db,
): Promise<void> {
    const accessToken =
        typeof token.access_token === "string" ? token.access_token : null;
    if (!accessToken) {
        throw new Error("OAuth token response did not include an access token.");
    }
    const refreshToken =
        typeof token.refresh_token === "string" ? token.refresh_token : undefined;
    // Preserve an existing refresh token when the server omits one on refresh.
    const existing = await loadDmsOAuthToken(connectorId, db);
    const existingRefresh = existing
        ? decryptString(
              existing.encrypted_refresh_token,
              existing.refresh_token_iv,
              existing.refresh_token_tag,
          )
        : null;
    const expiresIn =
        typeof token.expires_in === "number" ? token.expires_in : null;
    const row = {
        connector_id: connectorId,
        ...secretPatch("access_token", accessToken),
        ...secretPatch("refresh_token", refreshToken ?? existingRefresh),
        token_type:
            typeof token.token_type === "string" ? token.token_type : "Bearer",
        scope:
            typeof token.scope === "string" ? token.scope : ctx.scope ?? null,
        expires_at: expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null,
        authorization_server: ctx.authorizationServer,
        token_endpoint: ctx.tokenEndpoint,
        client_id: ctx.clientId,
        ...secretPatch("client_secret", ctx.clientSecret),
        resource: ctx.resource ?? null,
        updated_at: new Date().toISOString(),
    };
    const { error } = await db
        .from("dms_connector_oauth_tokens")
        .upsert(row, { onConflict: "connector_id" });
    if (error) throw error;
}

async function exchangeCode(
    tokenEndpoint: string,
    params: URLSearchParams,
): Promise<Record<string, unknown>> {
    const response = await guardedFetch(tokenEndpoint, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
    });
    if (!response.ok) {
        throw new Error(`OAuth token request failed (${response.status}).`);
    }
    const parsed = (await response.json()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
        throw new Error("OAuth token response was not an object.");
    }
    return parsed;
}

/**
 * Begin the auth-code flow: persist a hashed one-time state + encrypted PKCE
 * verifier and return the authorize URL for the browser to visit.
 */
export async function startDmsConnectorOAuth(
    userId: string,
    connectorId: string,
    redirectUri: string,
    db: Db = createServerSupabase(),
): Promise<{ authorizationUrl: string }> {
    const connector = await loadDmsConnector(userId, connectorId, db);
    const clientEnv = dmsOAuthClientEnv(connector.kind);
    if (!clientEnv.clientId) {
        throw new Error(
            `OAuth client credentials are not configured for ${connector.kind}.`,
        );
    }
    const { authorizationEndpoint, tokenEndpoint } = oauthEndpoints(
        connector.kind,
        connector.base_url,
        connector.config,
    );

    const stateToken = base64Url(crypto.randomBytes(32));
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = base64Url(
        crypto.createHash("sha256").update(codeVerifier).digest(),
    );

    const enc = encryptString(
        JSON.stringify({
            codeVerifier,
            redirectUri,
            tokenEndpoint,
            authorizationServer: authorizationEndpoint,
            clientId: clientEnv.clientId,
            clientSecret: clientEnv.clientSecret,
            scope: clientEnv.scope,
        }),
    );
    await db
        .from("dms_connector_oauth_states")
        .delete()
        .eq("state_hash", stateHash(stateToken));
    const { error } = await db.from("dms_connector_oauth_states").insert({
        user_id: userId,
        connector_id: connectorId,
        state_hash: stateHash(stateToken),
        encrypted_state_config: enc.encrypted,
        state_config_iv: enc.iv,
        state_config_tag: enc.tag,
        expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    });
    if (error) throw error;

    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientEnv.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", stateToken);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (clientEnv.scope) url.searchParams.set("scope", clientEnv.scope);
    return { authorizationUrl: url.toString() };
}

/** Complete the auth-code flow: exchange the code and store encrypted tokens. */
export async function completeDmsConnectorOAuth(
    state: string,
    code: string,
    db: Db = createServerSupabase(),
): Promise<{ userId: string; connectorId: string }> {
    const { data, error } = await db
        .from("dms_connector_oauth_states")
        .select("*")
        .eq("state_hash", stateHash(state))
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("OAuth state is invalid or expired.");
    const stateRow = data as {
        id: string;
        user_id: string;
        connector_id: string;
        encrypted_state_config: string;
        state_config_iv: string;
        state_config_tag: string;
    };
    const decrypted = decryptString(
        stateRow.encrypted_state_config,
        stateRow.state_config_iv,
        stateRow.state_config_tag,
    );
    if (!decrypted) throw new Error("OAuth state could not be decrypted.");
    const cfg = JSON.parse(decrypted) as {
        codeVerifier: string;
        redirectUri: string;
        tokenEndpoint: string;
        authorizationServer: string;
        clientId: string;
        clientSecret?: string;
        scope?: string;
    };

    const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        code_verifier: cfg.codeVerifier,
    });
    if (cfg.clientSecret) params.set("client_secret", cfg.clientSecret);
    const token = await exchangeCode(cfg.tokenEndpoint, params);

    await storeToken(
        stateRow.connector_id,
        {
            authorizationServer: cfg.authorizationServer,
            tokenEndpoint: cfg.tokenEndpoint,
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            scope: cfg.scope,
        },
        token,
        db,
    );
    await db
        .from("dms_connector_oauth_states")
        .delete()
        .eq("id", stateRow.id);
    return { userId: stateRow.user_id, connectorId: stateRow.connector_id };
}

async function refreshAccessToken(
    row: DmsOAuthTokenRow,
    db: Db,
): Promise<DmsOAuthTokenRow> {
    const refreshToken = decryptString(
        row.encrypted_refresh_token,
        row.refresh_token_iv,
        row.refresh_token_tag,
    );
    if (!refreshToken || !row.token_endpoint || !row.client_id) {
        throw new DmsOAuthRequiredError(
            "OAuth reconnect is required for this DMS connector.",
        );
    }
    const clientSecret = decryptString(
        row.encrypted_client_secret,
        row.client_secret_iv,
        row.client_secret_tag,
    );
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: row.client_id,
    });
    if (clientSecret) params.set("client_secret", clientSecret);
    if (row.scope) params.set("scope", row.scope);
    let token: Record<string, unknown>;
    try {
        token = await exchangeCode(row.token_endpoint, params);
    } catch {
        throw new DmsOAuthRequiredError(
            "OAuth token refresh failed. Please reconnect.",
        );
    }
    await storeToken(
        row.connector_id,
        {
            authorizationServer: row.authorization_server ?? "",
            tokenEndpoint: row.token_endpoint,
            clientId: row.client_id,
            clientSecret: clientSecret ?? undefined,
            scope: row.scope ?? undefined,
            resource: row.resource ?? undefined,
        },
        token,
        db,
    );
    const updated = await loadDmsOAuthToken(row.connector_id, db);
    if (!updated) throw new DmsOAuthRequiredError();
    return updated;
}

/**
 * Return a valid access token for the connector, transparently refreshing when
 * the stored token is within OAUTH_EXPIRY_SKEW_MS of expiry. This is what the
 * cloud adapters call via their `getAccessToken` config hook.
 */
export async function getValidDmsAccessToken(
    connectorId: string,
    db: Db = createServerSupabase(),
): Promise<string> {
    let token = await loadDmsOAuthToken(connectorId, db);
    if (!token?.encrypted_access_token) {
        throw new DmsOAuthRequiredError();
    }
    const expiresAt = token.expires_at ? Date.parse(token.expires_at) : null;
    if (expiresAt && expiresAt < Date.now() + OAUTH_EXPIRY_SKEW_MS) {
        token = await refreshAccessToken(token, db);
    }
    const accessToken = decryptString(
        token.encrypted_access_token,
        token.access_token_iv,
        token.access_token_tag,
    );
    if (!accessToken) throw new DmsOAuthRequiredError();
    return accessToken;
}

export function logDmsOAuthError(context: Record<string, unknown>, err: unknown) {
    logger.error(
        { ...context, error: err instanceof Error ? err.message : String(err) },
        "[dms-connectors] oauth error",
    );
}
