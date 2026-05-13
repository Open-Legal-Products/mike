import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS — only use in API routes after verifying the user.
 */
export function createServerSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Extract and verify the Supabase JWT from the Authorization header.
 * Returns the user's UUID string, or throws a Response with 401.
 */
export async function getUserIdFromRequest(req: Request): Promise<string> {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
        throw new Response("Missing or invalid Authorization header", { status: 401 });
    }
    const token = auth.slice(7).trim();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SECRET_KEY || "";

    if (!supabaseUrl || !serviceKey) {
        throw new Response("Server auth is not configured", { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data } = await admin.auth.getUser(token);
    if (!data.user) {
        throw new Response("Invalid or expired token", { status: 401 });
    }
    return data.user.id;
}
