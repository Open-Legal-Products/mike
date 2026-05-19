import { createHash } from "crypto";
import { Request, Response, NextFunction } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { JwtRsaVerifier } from "aws-jwt-verify";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import type { Fetcher } from "aws-jwt-verify/https";
import { ensureUserRow } from "../lib/users";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Real Cognito issues a UUIDv4 in the `sub` claim. cognito-local uses the
 * username (often an email) as `sub`, which breaks the `uuid` column type on
 * `public.users.id`. We deterministically derive a UUID-shaped value from
 * non-UUID subs so the local-dev flow still maps a single Cognito identity
 * to a single users row.
 */
function normalizeSub(sub: string): string {
  if (UUID_RE.test(sub)) return sub;
  const h = createHash("sha256").update(sub).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// In production we hit real Cognito over HTTPS. In local dev we point at
// cognito-local over plain HTTP, which aws-jwt-verify's built-in fetcher
// rejects. This custom fetcher uses Node 20's global `fetch` which has no
// such restriction.
class HttpAndHttpsFetcher implements Fetcher {
  async fetch(uri: string): Promise<ArrayBuffer> {
    const res = await globalThis.fetch(uri);
    if (!res.ok) {
      throw new Error(`fetch ${uri} returned HTTP ${res.status}`);
    }
    return await res.arrayBuffer();
  }
}

interface MikeVerifier {
  verify(token: string): Promise<{
    sub?: string;
    email?: string;
    [key: string]: unknown;
  }>;
}

let _verifier: MikeVerifier | null = null;

function getVerifier(): MikeVerifier {
  if (_verifier) return _verifier;

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set on the backend");
  }

  const jwksUri = process.env.COGNITO_JWKS_URI;
  if (jwksUri) {
    const issuer = process.env.COGNITO_ISSUER ?? jwksUri.replace("/.well-known/jwks.json", "");
    // Dev path: cognito-local serves JWKS over plain HTTP. Wire in our
    // custom fetcher via a fresh JwksCache so the HTTPS-only default is
    // bypassed.
    _verifier = JwtRsaVerifier.create(
      { issuer, audience: clientId, jwksUri },
      { jwksCache: new SimpleJwksCache({ fetcher: new HttpAndHttpsFetcher() }) },
    ) as unknown as MikeVerifier;
  } else {
    _verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    }) as unknown as MikeVerifier;
  }
  return _verifier;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Missing or invalid Authorization header" });
    return;
  }
  const token = auth.slice(7).trim();

  try {
    const payload = await getVerifier().verify(token);
    const rawSub = payload.sub;
    const email = payload.email?.toLowerCase() ?? "";
    if (!rawSub) {
      res.status(401).json({ detail: "Token missing sub claim" });
      return;
    }
    const sub = normalizeSub(rawSub);
    res.locals.userId = sub;
    res.locals.userEmail = email;
    res.locals.token = token;
    await ensureUserRow(sub, email);
    next();
  } catch (err) {
    console.warn("[auth] token verification failed:", err instanceof Error ? err.message : err);
    res.status(401).json({ detail: "Invalid or expired token" });
  }
}
