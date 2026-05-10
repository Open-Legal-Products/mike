/**
 * Local auth client (used when NEXT_PUBLIC_AUTH_MODE=local).
 *
 * Stores the JWT in localStorage. Provides the same surface used by
 * AuthContext and mikeApi so they work with minimal branching.
 */

const TOKEN_KEY = "mike_access_token";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export interface LocalUser {
    id: string;
    email: string;
}

export interface AuthSession {
    access_token: string;
    user: LocalUser;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const [, payload] = token.split(".");
        if (!payload) return null;
        let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        return JSON.parse(atob(b64)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export function isLocalMode(): boolean {
    return process.env.NEXT_PUBLIC_AUTH_MODE === "local";
}

export function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function getLocalUser(): LocalUser | null {
    const token = getToken();
    if (!token) return null;
    const payload = parseJwtPayload(token);
    if (!payload) return null;
    const exp = payload.exp as number | undefined;
    if (exp && exp < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
    }
    const id = (payload.sub ?? payload.id) as string | undefined;
    const email = payload.email as string | undefined;
    if (!id || !email) return null;
    return { id, email };
}

function saveToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

async function postAuth(path: string, body: Record<string, string>): Promise<AuthSession> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
        throw new Error(json?.detail ?? `Auth error ${res.status}`);
    }
    return json as AuthSession;
}

export async function localSignIn(email: string, password: string): Promise<AuthSession> {
    const session = await postAuth("/auth/login", { email, password });
    saveToken(session.access_token);
    return session;
}

export async function localSignUp(email: string, password: string): Promise<AuthSession> {
    const session = await postAuth("/auth/register", { email, password });
    saveToken(session.access_token);
    return session;
}

export function localSignOut(): void {
    clearToken();
}
