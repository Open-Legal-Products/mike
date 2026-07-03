/// <reference types="office-js" />
/**
 * Single source of truth for the add-in's Supabase session.
 *
 * The task pane authenticates with Supabase's password grant and then calls the
 * Mike API with the resulting JWT as a Bearer token. Those access tokens are
 * short-lived (Supabase defaults to a one-hour expiry), so a token persisted in
 * OfficeRuntime.storage during an earlier session is reliably expired by the
 * time the user reopens Word — and EVERY authenticated call then fails with
 * 401 "Invalid or expired token" (chat, projects, workflows, actions alike).
 * The original implementation stored ONLY the access token and never refreshed
 * it, so once that token aged out the session was wedged until a manual
 * sign-out / sign-in.
 *
 * This module fixes that by persisting the refresh token alongside the access
 * token and transparently exchanging it for a new access token when the current
 * one is expired (proactively, before a request leaves) or rejected (reactively,
 * when the API answers 401). Both the React auth hook (useAuth) and the bare
 * API client (api/client.ts) obtain their token through here, so a refresh
 * triggered by one is instantly visible to the other, and a refresh that
 * genuinely fails clears the session and drops every view back to the login
 * gate rather than looping on dead 401s.
 */

const ACCESS_KEY = "mike_token";
const REFRESH_KEY = "mike_refresh_token";

const SUPABASE_URL: string = process.env.REACT_APP_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY: string = process.env.REACT_APP_SUPABASE_ANON_KEY ?? "";

// Mike API base — same var the API client uses. In dev the pane calls it over
// the HTTPS proxy (https://localhost:3000/api → :3001) to avoid mixed content.
const API_BASE_URL: string =
  process.env.REACT_APP_API_BASE_URL ?? "http://localhost:3001";

// Refresh a little BEFORE the token's `exp` so an in-flight request can't race
// the expiry boundary (covers modest client/server clock skew too).
const EXPIRY_SKEW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Module-level shared state. Every useAuth() instance and the API client read
// through these, and broadcast() re-renders all subscribed hooks on change.
// ---------------------------------------------------------------------------

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _loading = true;
let _error: string | null = null;

let _initialized = false; // guards the hook's one-time load + loading flip
let _loadPromise: Promise<void> | null = null; // guards the storage read itself
let _refreshPromise: Promise<string | null> | null = null; // de-dupes concurrent refreshes

const _subscribers = new Set<() => void>();

function broadcast(): void {
  _subscribers.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

export interface SessionState {
  token: string | null;
  loading: boolean;
  error: string | null;
}

export function getSessionState(): SessionState {
  return { token: _accessToken, loading: _loading, error: _error };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Read the persisted tokens into memory exactly once. */
function ensureLoaded(): Promise<void> {
  if (!_loadPromise) {
    _loadPromise = Promise.all([
      OfficeRuntime.storage.getItem(ACCESS_KEY),
      OfficeRuntime.storage.getItem(REFRESH_KEY),
    ])
      .then(([access, refresh]) => {
        _accessToken = access ?? null;
        _refreshToken = refresh ?? null;
      })
      .catch(() => {
        _accessToken = null;
        _refreshToken = null;
      });
  }
  return _loadPromise;
}

/** Persist a freshly minted session (login or refresh) and notify subscribers. */
async function writeSession(
  access: string,
  refresh: string | null
): Promise<void> {
  _accessToken = access;
  _refreshToken = refresh;
  await OfficeRuntime.storage.setItem(ACCESS_KEY, access).catch(() => {});
  if (refresh) {
    await OfficeRuntime.storage.setItem(REFRESH_KEY, refresh).catch(() => {});
  } else {
    await OfficeRuntime.storage.removeItem(REFRESH_KEY).catch(() => {});
  }
  broadcast();
}

/** Drop the session from memory + storage and notify subscribers. */
async function clearSession(): Promise<void> {
  _accessToken = null;
  _refreshToken = null;
  await OfficeRuntime.storage.removeItem(ACCESS_KEY).catch(() => {});
  await OfficeRuntime.storage.removeItem(REFRESH_KEY).catch(() => {});
  broadcast();
}

// ---------------------------------------------------------------------------
// JWT expiry inspection
// ---------------------------------------------------------------------------

/** Decode a JWT's `exp` (seconds since epoch), or null if it isn't a JWT. */
function decodeExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/**
 * True when `token` is a JWT whose `exp` has passed (minus a safety skew).
 * Non-JWT or undecodable tokens return false — we can't prove they're stale, so
 * we let them go and rely on the reactive 401 path to catch a real rejection.
 */
function isExpired(token: string): boolean {
  const exp = decodeExp(token);
  if (exp == null) return false;
  return Date.now() / 1000 >= exp - EXPIRY_SKEW_SECONDS;
}

// ---------------------------------------------------------------------------
// Token acquisition
// ---------------------------------------------------------------------------

/**
 * Return a usable access token for an outgoing API request, refreshing first if
 * the current one has expired. May return null (logged out / refresh failed),
 * in which case the request will 401 and the reactive path takes over.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  await ensureLoaded();
  if (_accessToken && !isExpired(_accessToken)) return _accessToken;
  if (_refreshToken) {
    const refreshed = await refreshSession();
    if (refreshed) return refreshed;
  }
  return _accessToken;
}

/**
 * Exchange the refresh token for a new access token. Concurrent callers share a
 * single in-flight request. On a definitive failure (no refresh token, or the
 * grant is rejected) the session is cleared so the UI returns to login; a
 * transient network error leaves the session intact so a later retry can work.
 */
export function refreshSession(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

async function doRefresh(): Promise<string | null> {
  await ensureLoaded();
  if (!_refreshToken) {
    // Nothing to refresh with (e.g. a pre-refresh-era stored token). Force a
    // clean re-login rather than spinning on 401s.
    await clearSession();
    return null;
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: _refreshToken }),
    });
  } catch {
    // Network blip — keep the session and let the caller surface the failure.
    return null;
  }

  if (!res.ok) {
    // The refresh token itself is invalid/expired/revoked: log out.
    await clearSession();
    return null;
  }

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!data.access_token) {
    await clearSession();
    return null;
  }

  // Supabase rotates refresh tokens — persist the new one (falling back to the
  // existing token if the response omitted it).
  await writeSession(data.access_token, data.refresh_token ?? _refreshToken);
  return data.access_token;
}

// ---------------------------------------------------------------------------
// React-hook-facing lifecycle + auth actions
// ---------------------------------------------------------------------------

/** Kick off the one-time storage read, flipping `loading` false when done. */
export function initialize(): void {
  if (_initialized) return;
  _initialized = true;
  void ensureLoaded().then(() => {
    _loading = false;
    broadcast();
  });
}

export async function signIn(email: string, password: string): Promise<void> {
  _loading = true;
  _error = null;
  broadcast();

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_description?: string;
        message?: string;
        error?: string;
      };
      throw new Error(
        body.error_description ?? body.message ?? body.error ?? "Login failed"
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    await writeSession(data.access_token, data.refresh_token ?? null);
    _loading = false;
    _error = null;
    broadcast();
  } catch (e) {
    _loading = false;
    _error = e instanceof Error ? e.message : "Login failed";
    broadcast();
  }
}

/**
 * Sign in as an ephemeral guest (local development only). Mirrors the web app:
 * POST {API}/auth/guest returns a Supabase session which we persist like a
 * normal login. The endpoint is gated to non-production on the server too.
 */
export async function signInAsGuest(): Promise<void> {
  _loading = true;
  _error = null;
  broadcast();

  try {
    const res = await fetch(`${API_BASE_URL}/auth/guest`, { method: "POST" });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
      };
      throw new Error(
        body.detail ?? body.message ?? "Guest login is unavailable"
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    await writeSession(data.access_token, data.refresh_token ?? null);
    _loading = false;
    _error = null;
    broadcast();
  } catch (e) {
    _loading = false;
    _error = e instanceof Error ? e.message : "Guest login failed";
    broadcast();
  }
}

export async function signOut(): Promise<void> {
  _error = null;
  await clearSession();
}
