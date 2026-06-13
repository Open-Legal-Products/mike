import { NextRequest } from "next/server";

/**
 * Auth is disabled in the local / OSS setup — every request resolves to the
 * single hardcoded local user. Kept for signature compatibility; no token is
 * validated and no Supabase call is made.
 */
export async function getUserFromRequest(_request: NextRequest): Promise<{
  email: string;
  id: string;
} | null> {
  return {
    email: "local@localhost",
    id: "00000000-0000-0000-0000-000000000001",
  };
}
