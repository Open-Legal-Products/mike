import { createClient } from "@supabase/supabase-js";
import { isLocalMode, getToken } from "@/lib/localAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";

// When Supabase is not configured (local mode) createClient would throw with
// an empty URL. Use a dummy localhost URL so the module loads safely; calls to
// supabase.auth.* will simply return null sessions, which is fine because all
// auth is handled via localAuth in that mode.
export const supabase = createClient(
    supabaseUrl || "http://localhost:54321",
    supabaseAnonKey || "placeholder-local-key",
);

/**
 * Returns the current Bearer token regardless of auth mode.
 * Replaces the scattered `supabase.auth.getSession()` calls so components
 * don't need to know which mode they're running in.
 */
export async function getSessionToken(): Promise<string | null> {
    if (isLocalMode()) return getToken();
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
}
