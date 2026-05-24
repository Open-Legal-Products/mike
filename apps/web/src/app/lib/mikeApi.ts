import { supabase } from "@/lib/supabase";
import { configureMikeApiClient } from "@mike/api-client";

configureMikeApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
  async getAuthHeaders(): Promise<Record<string, string>> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  },
});

export * from "@mike/api-client";
