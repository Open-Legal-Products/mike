import { Request, Response, NextFunction } from "express";
import { LOCAL_USER_EMAIL, LOCAL_USER_ID } from "../lib/supabase";

/**
 * Auth is disabled for the local / OSS setup.
 *
 * Every request is treated as the single hardcoded local user. No tokens are
 * checked and no Supabase calls are made. The rest of the codebase reads the
 * user from `res.locals.userId` / `res.locals.userEmail`, so we populate those
 * (and `req.user`) and pass straight through.
 *
 * The user id is a real UUID because every `user_id` column in the schema is
 * typed `uuid`; it matches the row seeded by the one-shot migration.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.userId = LOCAL_USER_ID;
  res.locals.userEmail = LOCAL_USER_EMAIL;
  res.locals.token = "local-dev-token";
  (req as Request & { user?: { id: string; email: string } }).user = {
    id: LOCAL_USER_ID,
    email: LOCAL_USER_EMAIL,
  };
  next();
}

/**
 * MFA is not used locally — always allow.
 */
export function requireMfaIfEnrolled(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}
