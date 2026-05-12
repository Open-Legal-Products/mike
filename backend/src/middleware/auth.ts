// Auth middleware (Stage D of the AWS migration).
//
// Replaces the previous Supabase `auth.getUser(token)` flow with Clerk JWT
// verification. The bearer token is verified with `@clerk/backend`'s
// `verifyToken`, which uses the offline `CLERK_JWT_KEY` (PEM public key) when
// available and falls back to a JWKS lookup against Clerk's Frontend API.
//
// After verifying the JWT we run the "ensure profile" bootstrap inline: on the
// first request from a given Clerk user (per process lifetime) we look up the
// user's primary email via the Clerk Backend API, lowercase it, upsert a
// `user_profiles` row, and cache the user id + email in-process. This replaces
// the Supabase `handle_new_user` trigger which was deleted in Stage C. The
// in-memory cache avoids repeated upserts on subsequent requests.

import type { NextFunction, Request, Response } from "express";
import {
  createClerkClient,
  verifyToken,
  type ClerkClient,
} from "@clerk/backend";
import { db } from "../lib/db";
import { userProfiles } from "../db/schema";

// ---------------------------------------------------------------------------
// Module-level caches & lazy Clerk client
// ---------------------------------------------------------------------------

/**
 * Set of Clerk user IDs we have already bootstrapped during this process's
 * lifetime. First-request profile bootstrap replaces the Supabase
 * `handle_new_user` trigger; this in-memory cache avoids repeated upserts on
 * every subsequent request.
 */
const bootstrappedUsers = new Set<string>();

/**
 * Cache of Clerk user ID → primary email (lowercased). Populated alongside
 * the bootstrap so cached requests still have `res.locals.userEmail` set for
 * route handlers that haven't been rewritten to Drizzle yet.
 */
const userEmailCache = new Map<string, string>();

let clerkClient: ClerkClient | null = null;

function getClerkClient(): ClerkClient {
  if (clerkClient) return clerkClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }
  clerkClient = createClerkClient({
    secretKey,
    publishableKey,
  });
  return clerkClient;
}

// ---------------------------------------------------------------------------
// Profile bootstrap
// ---------------------------------------------------------------------------

/**
 * Look up the Clerk user's primary email and upsert a `user_profiles` row.
 * Idempotent — a duplicate row is prevented by the unique constraint on
 * `user_profiles.user_id`. Returns the lowercased primary email (may be the
 * empty string if Clerk has none on file, which shouldn't happen in
 * production but we don't want to crash auth on that).
 */
async function bootstrapProfile(userId: string): Promise<string> {
  const client = getClerkClient();
  let email = "";
  try {
    const user = await client.users.getUser(userId);
    const primaryId = user.primaryEmailAddressId;
    const primary = primaryId
      ? user.emailAddresses.find((e) => e.id === primaryId)
      : user.emailAddresses[0];
    email = (primary?.emailAddress ?? "").toLowerCase();
  } catch (err) {
    console.warn(
      `[auth] Failed to fetch Clerk user ${userId} for profile bootstrap:`,
      err,
    );
  }

  await db
    .insert(userProfiles)
    .values({ userId })
    .onConflictDoNothing({ target: userProfiles.userId });

  return email;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Missing or invalid Authorization header" });
    return;
  }
  const token = auth.slice(7).trim();

  const secretKey = process.env.CLERK_SECRET_KEY;
  const jwtKey = process.env.CLERK_JWT_KEY;
  if (!secretKey) {
    res.status(500).json({ detail: "Server auth is not configured" });
    return;
  }

  let userId: string;
  try {
    const payload = await verifyToken(token, {
      secretKey,
      // When CLERK_JWT_KEY (PEM public key) is provided we verify offline and
      // skip the JWKS HTTP round trip. Otherwise verifyToken falls back to
      // fetching JWKS from Clerk's Frontend API.
      ...(jwtKey ? { jwtKey } : {}),
    });
    if (!payload.sub) {
      res.status(401).json({ detail: "Invalid or expired token" });
      return;
    }
    userId = payload.sub;
  } catch (err) {
    console.warn("[auth] Clerk token verification failed:", err);
    res.status(401).json({ detail: "Invalid or expired token" });
    return;
  }

  // First request per user per process: fetch email + upsert profile. Use the
  // in-memory cache to skip both DB and Clerk API round trips for subsequent
  // requests by the same user.
  let userEmail = userEmailCache.get(userId) ?? "";
  if (!bootstrappedUsers.has(userId)) {
    try {
      userEmail = await bootstrapProfile(userId);
      userEmailCache.set(userId, userEmail);
      bootstrappedUsers.add(userId);
    } catch (err) {
      // Don't block auth on a DB/Clerk hiccup — log and continue. The next
      // request will retry the bootstrap because we never marked the user as
      // bootstrapped.
      console.error(
        `[auth] Profile bootstrap failed for ${userId}:`,
        err,
      );
    }
  }

  res.locals.userId = userId;
  res.locals.userEmail = userEmail;
  res.locals.token = token;
  next();
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/**
 * Reset the module-level caches. Intended for tests; not used at runtime.
 */
export function __resetAuthCaches(): void {
  bootstrappedUsers.clear();
  userEmailCache.clear();
}
