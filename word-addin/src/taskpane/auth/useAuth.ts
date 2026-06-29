/// <reference types="office-js" />
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mike_token";
const SUPABASE_URL: string = process.env.REACT_APP_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY: string = process.env.REACT_APP_SUPABASE_ANON_KEY ?? "";

// ---------------------------------------------------------------------------
// Module-level shared state so every useAuth() instance stays in sync.
// When the token changes (login / logout), all mounted hooks re-render.
// ---------------------------------------------------------------------------

let _token: string | null = null;
let _loading = true;
let _error: string | null = null;
let _initialized = false;

const _subscribers = new Set<() => void>();

function broadcast(): void {
  _subscribers.forEach((fn) => fn());
}

function initOnce(): void {
  if (_initialized) return;
  _initialized = true;

  OfficeRuntime.storage
    .getItem(STORAGE_KEY)
    .then((value) => {
      _token = value ?? null;
      _loading = false;
      broadcast();
    })
    .catch(() => {
      _token = null;
      _loading = false;
      broadcast();
    });
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AuthState {
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState {
  // A counter-based forceUpdate so we avoid storing duplicated state.
  const [, rerender] = useState(0);

  useEffect(() => {
    const sub = () => rerender((n) => n + 1);
    _subscribers.add(sub);
    initOnce();
    return () => {
      _subscribers.delete(sub);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      _loading = true;
      _error = null;
      broadcast();

      try {
        const res = await fetch(
          `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ email, password }),
          }
        );

        if (!res.ok) {
          const body = (await res.json()) as {
            error_description?: string;
            message?: string;
            error?: string;
          };
          throw new Error(
            body.error_description ??
              body.message ??
              body.error ??
              "Login failed"
          );
        }

        const data = (await res.json()) as { access_token: string };
        await OfficeRuntime.storage.setItem(STORAGE_KEY, data.access_token);
        _token = data.access_token;
        _loading = false;
        _error = null;
        broadcast();
      } catch (e) {
        _loading = false;
        _error = e instanceof Error ? e.message : "Login failed";
        broadcast();
      }
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await OfficeRuntime.storage.removeItem(STORAGE_KEY);
    } catch {
      // best-effort removal
    }
    _token = null;
    _error = null;
    broadcast();
  }, []);

  return {
    token: _token,
    loading: _loading,
    error: _error,
    login,
    logout,
  };
}
