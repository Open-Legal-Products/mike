import { createServerSupabase } from "../supabase";
import type { DmsKind } from "./adapter";

export type Db = ReturnType<typeof createServerSupabase>;

/** Only OAuth2 auth-code + refresh is supported for the cloud DMS backends. */
export type DmsAuthType = "oauth";

/** A row in public.dms_connectors. */
export interface DmsConnectorRow {
    id: string;
    user_id: string;
    kind: DmsKind;
    name: string;
    base_url: string;
    auth_type: DmsAuthType;
    enabled: boolean;
    encrypted_auth_config: string | null;
    auth_config_iv: string | null;
    auth_config_tag: string | null;
    config: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
}

/**
 * A row in public.dms_connector_oauth_tokens. Column-for-column identical to
 * user_mcp_oauth_tokens so the same encrypt/refresh helpers apply unchanged.
 */
export interface DmsOAuthTokenRow {
    id: string;
    connector_id: string;
    encrypted_access_token: string | null;
    access_token_iv: string | null;
    access_token_tag: string | null;
    encrypted_refresh_token: string | null;
    refresh_token_iv: string | null;
    refresh_token_tag: string | null;
    token_type: string | null;
    scope: string | null;
    expires_at: string | null;
    authorization_server: string | null;
    token_endpoint: string | null;
    client_id: string | null;
    encrypted_client_secret: string | null;
    client_secret_iv: string | null;
    client_secret_tag: string | null;
    resource: string | null;
    created_at: string;
    updated_at: string;
}

/** Summary of a connector returned to callers (never leaks secrets). */
export interface DmsConnectorSummary {
    id: string;
    kind: DmsKind;
    name: string;
    baseUrl: string;
    authType: DmsAuthType;
    enabled: boolean;
    oauthConnected: boolean;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

/** Refresh the OAuth access token this many ms before it actually expires. */
export const OAUTH_EXPIRY_SKEW_MS = 60_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Cap the number of search results an adapter will return. */
export const DMS_SEARCH_LIMIT = 50;
