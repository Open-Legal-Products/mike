import { Request, Response, NextFunction } from "express";
import { getAdminClient } from "../lib/supabase";
import { sendError } from "../lib/http";
import { logger } from "../lib/logger";

/**
 * The /user/profile (and /users/profile alias) endpoint must stay reachable
 * even before a second factor is verified, otherwise the client cannot learn
 * that MFA is required or render the verification gate. Treat it as the MFA
 * bootstrap route.
 */
function isLoginMfaBootstrapRoute(req: Request): boolean {
  const path = req.originalUrl.split("?")[0];
  return (
    (req.method === "GET" || req.method === "POST") &&
    (path === "/user/profile" || path === "/users/profile")
  );
}

/**
 * When a user has opted into MFA-on-login, every authenticated request must be
 * carried by an aal2 session. Returns true when the request may proceed and
 * false when a response (401/403/500) has already been sent.
 */
async function enforceLoginMfaIfEnabled(
  req: Request,
  res: Response,
  token: string,
): Promise<boolean> {
  if (isLoginMfaBootstrapRoute(req)) return true;

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_profiles")
    .select("mfa_on_login")
    .eq("user_id", res.locals.userId)
    .maybeSingle();

  if (error) {
    // 42703 = column does not exist (older databases without the
    // mfa_on_login column): fail open so the app keeps working.
    if (error.code === "42703") return true;
    logger.warn(
      { path: req.originalUrl, code: error.code },
      "MFA login preference lookup failed",
    );
    sendError(res, 500, "INTERNAL_ERROR", error.message);
    return false;
  }

  const profile = data as { mfa_on_login?: boolean } | null;
  if (profile?.mfa_on_login !== true) return true;

  const { data: assurance, error: assuranceError } =
    await admin.auth.mfa.getAuthenticatorAssuranceLevel(token);

  if (assuranceError) {
    logger.warn(
      { path: req.originalUrl },
      "MFA login assurance lookup failed",
    );
    sendError(res, 401, "UNAUTHORIZED", assuranceError.message);
    return false;
  }

  if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    // Exact response shape consumed by the web client's MFA login gate.
    res.status(403).json({
      code: "mfa_verification_required",
      detail: "MFA verification required",
    });
    return false;
  }

  return true;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Missing or invalid Authorization header");
    return;
  }
  const token = auth.slice(7).trim();

  const { data } = await getAdminClient().auth.getUser(token);
  if (!data.user) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid or expired token");
    return;
  }

  res.locals.userId = data.user.id;
  res.locals.userEmail = data.user.email?.toLowerCase() ?? "";
  res.locals.token = token;

  if (!(await enforceLoginMfaIfEnabled(req, res, token))) {
    return;
  }
  next();
}

/**
 * Route-level guard for sensitive actions (changing security settings,
 * exporting or deleting account data). When the caller has a verified TOTP
 * factor enrolled, the current session must be aal2.
 */
export async function requireMfaIfEnrolled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = typeof res.locals.token === "string" ? res.locals.token : "";
  if (!token) {
    sendError(res, 401, "UNAUTHORIZED", "Missing auth session");
    return;
  }

  const admin = getAdminClient();
  const { data, error } =
    await admin.auth.mfa.getAuthenticatorAssuranceLevel(token);

  if (error) {
    logger.warn({ path: req.originalUrl }, "MFA assurance lookup failed");
    sendError(res, 401, "UNAUTHORIZED", error.message);
    return;
  }

  if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
    // Exact response shape consumed by the web client's MFA verification flow.
    res.status(403).json({
      code: "mfa_verification_required",
      detail: "MFA verification required",
    });
    return;
  }

  next();
}
