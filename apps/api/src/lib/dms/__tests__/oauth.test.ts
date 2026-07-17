import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DNS so the guarded token-endpoint fetch clears the SSRF guard.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));

import {
    completeDmsConnectorOAuth,
    getValidDmsAccessToken,
    startDmsConnectorOAuth,
} from "../oauth";
import { createFakeSupabase, type FakeDb } from "./fakeDb";

const BASE = "https://tenant.imanage.com";
const CONNECTOR_ID = "conn-1";
const USER_ID = "user-1";
const REDIRECT = "https://app.example.com/user/dms-connectors/oauth/callback";

interface Captured {
    url: string;
    init: RequestInit | undefined;
}
let calls: Captured[];

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    return vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: unknown, init?: RequestInit) => {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : (input as Request).url;
            calls.push({ url, init });
            return Promise.resolve(handler(url, init));
        });
}

function tokenJson(body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function seededDb(): FakeDb {
    return createFakeSupabase({
        dms_connectors: [
            {
                id: CONNECTOR_ID,
                user_id: USER_ID,
                kind: "imanage",
                name: "iManage",
                base_url: BASE,
                auth_type: "oauth",
                enabled: true,
                config: {},
            },
        ],
        dms_connector_oauth_tokens: [],
        dms_connector_oauth_states: [],
    });
}

function stateFromUrl(url: string): string {
    return new URL(url).searchParams.get("state") ?? "";
}

beforeAll(() => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET =
        "dms-test-master-secret-at-least-32-chars";
});

beforeEach(() => {
    calls = [];
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    process.env.IMANAGE_OAUTH_CLIENT_ID = "client-abc";
    process.env.IMANAGE_OAUTH_CLIENT_SECRET = "secret-xyz";
    process.env.IMANAGE_OAUTH_SCOPE = "user";
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("DMS OAuth flow", () => {
    it("start returns an authorize URL with PKCE + state and persists state", async () => {
        const db = seededDb();
        const { authorizationUrl } = await startDmsConnectorOAuth(
            USER_ID,
            CONNECTOR_ID,
            REDIRECT,
            db as never,
        );
        const url = new URL(authorizationUrl);
        expect(url.origin + url.pathname).toBe(`${BASE}/auth/oauth2/authorize`);
        expect(url.searchParams.get("client_id")).toBe("client-abc");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toBeTruthy();
        expect(url.searchParams.get("state")).toBeTruthy();
        expect(url.searchParams.get("scope")).toBe("user");
        expect(db._tables.dms_connector_oauth_states).toHaveLength(1);
    });

    it("start fails when no OAuth client credentials are configured", async () => {
        delete process.env.IMANAGE_OAUTH_CLIENT_ID;
        const db = seededDb();
        await expect(
            startDmsConnectorOAuth(USER_ID, CONNECTOR_ID, REDIRECT, db as never),
        ).rejects.toThrow(/client credentials/);
    });

    it("callback exchanges the code and stores encrypted tokens", async () => {
        const db = seededDb();
        const { authorizationUrl } = await startDmsConnectorOAuth(
            USER_ID,
            CONNECTOR_ID,
            REDIRECT,
            db as never,
        );
        const state = stateFromUrl(authorizationUrl);

        mockFetch(() =>
            tokenJson({
                access_token: "access-1",
                refresh_token: "refresh-1",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        );
        const result = await completeDmsConnectorOAuth(
            state,
            "auth-code",
            db as never,
        );
        expect(result).toEqual({
            userId: USER_ID,
            connectorId: CONNECTOR_ID,
        });
        // Token endpoint hit with the auth-code grant + PKCE verifier.
        expect(calls[0].url).toBe(`${BASE}/auth/oauth2/token`);
        const body = String((calls[0].init as RequestInit).body);
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=auth-code");
        expect(body).toContain("code_verifier=");
        // Stored token is encrypted (not the plaintext) and the state consumed.
        const stored = db._tables.dms_connector_oauth_tokens[0];
        expect(stored.encrypted_access_token).toBeTruthy();
        expect(String(stored.encrypted_access_token)).not.toContain("access-1");
        expect(db._tables.dms_connector_oauth_states).toHaveLength(0);

        // A valid, non-expiring token is returned as-is (no refresh call).
        calls.length = 0;
        const token = await getValidDmsAccessToken(CONNECTOR_ID, db as never);
        expect(token).toBe("access-1");
        expect(calls).toHaveLength(0);
    });

    it("refreshes the access token when it is within the expiry skew", async () => {
        const db = seededDb();
        const { authorizationUrl } = await startDmsConnectorOAuth(
            USER_ID,
            CONNECTOR_ID,
            REDIRECT,
            db as never,
        );
        const state = stateFromUrl(authorizationUrl);
        mockFetch(() =>
            tokenJson({
                access_token: "access-1",
                refresh_token: "refresh-1",
                expires_in: 3600,
            }),
        );
        await completeDmsConnectorOAuth(state, "auth-code", db as never);

        // Force the stored token to look near-expiry so the next read refreshes.
        db._tables.dms_connector_oauth_tokens[0].expires_at = new Date(
            Date.now() + 10_000,
        ).toISOString();

        calls.length = 0;
        mockFetch((_url, init) => {
            expect(String((init as RequestInit).body)).toContain(
                "grant_type=refresh_token",
            );
            return tokenJson({ access_token: "access-2", expires_in: 3600 });
        });
        const token = await getValidDmsAccessToken(CONNECTOR_ID, db as never);
        expect(token).toBe("access-2");
        expect(calls[0].url).toBe(`${BASE}/auth/oauth2/token`);
    });
});
