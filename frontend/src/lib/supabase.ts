import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "local-dev-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
