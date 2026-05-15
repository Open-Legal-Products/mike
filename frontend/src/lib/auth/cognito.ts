"use client";
/**
 * Cognito wrapper exposing a `supabase`-shaped API so the rest of the
 * frontend (11 call sites) can keep its existing import shape.
 *
 * Key choice: `session.access_token` returns the Cognito *ID* token, not the
 * Cognito *access* token. The backend's `requireAuth` middleware verifies
 * `tokenUse: "id"` and reads the `email` and `sub` claims, so the bearer must
 * be the ID token. Naming `access_token` keeps the Supabase shape; consumers
 * never have to know.
 */

import {
    AuthenticationDetails,
    CognitoUser,
    CognitoUserAttribute,
    CognitoUserPool,
    CognitoUserSession,
    type ICognitoUserPoolData,
} from "amazon-cognito-identity-js";

interface PublicUser {
    id: string;
    email: string;
}

interface Session {
    user: PublicUser;
    access_token: string; // really the Cognito ID token (see file header)
    id_token: string;
    refresh_token: string;
    expires_at: number;
}

interface ApiResult<T> {
    data: T;
    error: { name?: string; message: string } | null;
}

// ---------------------------------------------------------------------------
// Pool config
// ---------------------------------------------------------------------------

function poolConfig(): ICognitoUserPoolData {
    const UserPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    const ClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
    if (!UserPoolId || !ClientId) {
        throw new Error(
            "NEXT_PUBLIC_COGNITO_USER_POOL_ID and NEXT_PUBLIC_COGNITO_CLIENT_ID must be set",
        );
    }
    const endpoint = process.env.NEXT_PUBLIC_COGNITO_ENDPOINT;
    const config: ICognitoUserPoolData = { UserPoolId, ClientId };
    if (endpoint) {
        (config as ICognitoUserPoolData & { endpoint?: string }).endpoint =
            endpoint;
    }
    return config;
}

let _pool: CognitoUserPool | null = null;
function pool(): CognitoUserPool {
    if (typeof window === "undefined") {
        throw new Error(
            "Cognito client is browser-only; call this from a Client Component",
        );
    }
    if (!_pool) _pool = new CognitoUserPool(poolConfig());
    return _pool;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function sessionFromCognito(
    cognitoUser: CognitoUser,
    cognitoSession: CognitoUserSession,
): Session {
    const idPayload = cognitoSession.getIdToken().decodePayload() as {
        sub?: string;
        email?: string;
    };
    return {
        user: {
            id: idPayload.sub ?? cognitoUser.getUsername(),
            email: idPayload.email ?? "",
        },
        access_token: cognitoSession.getIdToken().getJwtToken(),
        id_token: cognitoSession.getIdToken().getJwtToken(),
        refresh_token: cognitoSession.getRefreshToken().getToken(),
        expires_at: cognitoSession.getIdToken().getExpiration(),
    };
}

async function getSessionInternal(): Promise<Session | null> {
    const current = pool().getCurrentUser();
    if (!current) return null;
    return new Promise<Session | null>((resolve) => {
        current.getSession(
            (err: Error | null, sess: CognitoUserSession | null) => {
                if (err || !sess || !sess.isValid()) {
                    resolve(null);
                    return;
                }
                resolve(sessionFromCognito(current, sess));
            },
        );
    });
}

// ---------------------------------------------------------------------------
// onAuthStateChange — pub/sub backed by localStorage so multi-tab updates
// (sign-in in another tab) propagate.
// ---------------------------------------------------------------------------

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
type AuthCallback = (event: AuthEvent, session: Session | null) => void;

const listeners = new Set<AuthCallback>();

function notifyListeners(event: AuthEvent, session: Session | null): void {
    listeners.forEach((cb) => {
        try {
            cb(event, session);
        } catch (e) {
            console.error("[auth] listener threw", e);
        }
    });
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", (ev) => {
        if (!ev.key?.startsWith("CognitoIdentityServiceProvider.")) return;
        // Storage event: re-resolve current session and notify.
        getSessionInternal().then((s) =>
            notifyListeners(s ? "TOKEN_REFRESHED" : "SIGNED_OUT", s),
        );
    });
}

// ---------------------------------------------------------------------------
// Supabase-shaped surface
// ---------------------------------------------------------------------------

export const supabase = {
    auth: {
        async getSession(): Promise<ApiResult<{ session: Session | null }>> {
            try {
                const session = await getSessionInternal();
                return { data: { session }, error: null };
            } catch (e) {
                return {
                    data: { session: null },
                    error: {
                        message: e instanceof Error ? e.message : String(e),
                    },
                };
            }
        },

        onAuthStateChange(callback: AuthCallback): {
            data: { subscription: { unsubscribe: () => void } };
        } {
            listeners.add(callback);
            // Fire once on subscribe so consumers can prime their state.
            getSessionInternal().then((s) =>
                callback(s ? "SIGNED_IN" : "SIGNED_OUT", s),
            );
            return {
                data: {
                    subscription: {
                        unsubscribe: () => listeners.delete(callback),
                    },
                },
            };
        },

        async signUp(params: {
            email: string;
            password: string;
        }): Promise<
            ApiResult<{
                user: { id: string; email: string } | null;
                session: Session | null;
            }>
        > {
            const attributes = [
                new CognitoUserAttribute({
                    Name: "email",
                    Value: params.email,
                }),
            ];
            return new Promise((resolve) => {
                pool().signUp(
                    params.email,
                    params.password,
                    attributes,
                    [],
                    (err, result) => {
                        if (err) {
                            resolve({
                                data: { user: null, session: null },
                                error: { message: err.message ?? String(err) },
                            });
                            return;
                        }
                        resolve({
                            data: {
                                user: result
                                    ? {
                                          id: result.userSub,
                                          email: params.email,
                                      }
                                    : null,
                                session: null, // Cognito requires email confirmation first
                            },
                            error: null,
                        });
                    },
                );
            });
        },

        async confirmSignUp(params: {
            email: string;
            code: string;
        }): Promise<ApiResult<{ confirmed: boolean }>> {
            const cognitoUser = new CognitoUser({
                Username: params.email,
                Pool: pool(),
            });
            return new Promise((resolve) => {
                cognitoUser.confirmRegistration(
                    params.code,
                    true,
                    (err, result) => {
                        if (err) {
                            resolve({
                                data: { confirmed: false },
                                error: { message: err.message ?? String(err) },
                            });
                            return;
                        }
                        resolve({
                            data: { confirmed: result === "SUCCESS" },
                            error: null,
                        });
                    },
                );
            });
        },

        async resendConfirmationCode(params: {
            email: string;
        }): Promise<ApiResult<{ sent: boolean }>> {
            const cognitoUser = new CognitoUser({
                Username: params.email,
                Pool: pool(),
            });
            return new Promise((resolve) => {
                cognitoUser.resendConfirmationCode((err) => {
                    if (err) {
                        resolve({
                            data: { sent: false },
                            error: { message: err.message ?? String(err) },
                        });
                        return;
                    }
                    resolve({ data: { sent: true }, error: null });
                });
            });
        },

        async signInWithPassword(params: {
            email: string;
            password: string;
        }): Promise<ApiResult<{ session: Session | null }>> {
            const cognitoUser = new CognitoUser({
                Username: params.email,
                Pool: pool(),
            });
            const authDetails = new AuthenticationDetails({
                Username: params.email,
                Password: params.password,
            });
            return new Promise((resolve) => {
                cognitoUser.authenticateUser(authDetails, {
                    onSuccess: (cognitoSession) => {
                        const session = sessionFromCognito(
                            cognitoUser,
                            cognitoSession,
                        );
                        notifyListeners("SIGNED_IN", session);
                        resolve({ data: { session }, error: null });
                    },
                    onFailure: (err) => {
                        resolve({
                            data: { session: null },
                            error: { message: err.message ?? String(err) },
                        });
                    },
                });
            });
        },

        async signOut(): Promise<ApiResult<null>> {
            const current = pool().getCurrentUser();
            if (current) current.signOut();
            notifyListeners("SIGNED_OUT", null);
            return { data: null, error: null };
        },
    },
};

export type { Session };
