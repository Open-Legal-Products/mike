import { db } from "../db";
import { users } from "../db/schema";

/**
 * Idempotently insert a row in `public.users` mirroring a Cognito identity.
 * Called from requireAuth after token verification. Replaces the Postgres
 * trigger `on_auth_user_created` that fired against `auth.users` in Supabase.
 */
export async function ensureUserRow(sub: string, email: string): Promise<void> {
  await db.insert(users).values({ id: sub, email }).onConflictDoNothing({ target: users.id });
}
