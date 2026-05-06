import { createClient } from "@supabase/supabase-js";

export function createServerSupabase() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || "";
  return createClient(url, key, { auth: { persistSession: false } });
}
