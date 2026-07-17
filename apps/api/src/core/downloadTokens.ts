// Token expiry (the `exp` field and its 30-day default TTL) adapted from
// upstream PR #77 by bmersereau (https://github.com/willchen96/mike/pull/77);
// this fork additionally rejects tokens that carry no expiry at all.
import crypto from "crypto";

export type DownloadTokenPayload = {
  path: string;
  filename: string;
  /** Unix timestamp (seconds) after which the token is invalid. */
  exp?: number;
};

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

function timingSafeEqStr(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 1);
  const aBuf = Buffer.alloc(maxLen, 0);
  const bBuf = Buffer.alloc(maxLen, 0);
  Buffer.from(a).copy(aBuf);
  Buffer.from(b).copy(bBuf);
  return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function signDownloadPayload(
  payload: DownloadTokenPayload,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds;
  const encodedPayload = b64urlEncode(
    Buffer.from(
      JSON.stringify({ p: payload.path, f: payload.filename, e: exp }),
      "utf8",
    ),
  );
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest();
  return `${encodedPayload}.${b64urlEncode(signature)}`;
}

export function verifyDownloadPayload(
  token: string,
  secret: string,
): DownloadTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest();

  if (!timingSafeEqStr(encodedSignature, b64urlEncode(expectedSignature))) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      b64urlDecode(encodedPayload).toString("utf8"),
    ) as {
      p: unknown;
      f: unknown;
      e?: unknown;
    };
    if (typeof parsed.p !== "string" || typeof parsed.f !== "string") {
      return null;
    }
    if (!parsed.p || !parsed.f) return null;
    // Every token must carry an expiry. A token without `e` is legacy (issued
    // before expiry existed) and would otherwise be valid forever, so reject it
    // — any such link is long stale (all issuers have set `e` since), and a
    // fresh, expiring token is re-issued on next access.
    if (
      typeof parsed.e !== "number" ||
      parsed.e < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { path: parsed.p, filename: parsed.f };
  } catch {
    return null;
  }
}
