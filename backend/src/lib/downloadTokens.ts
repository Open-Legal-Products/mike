import {
  signDownloadPayload,
  verifyDownloadPayload,
} from "../core/downloadTokens";

/**
 * HMAC-signed download tokens with a mandatory expiry (30 days by default).
 *
 * The token encodes the R2 storage path + filename + expiry; the backend
 * route `/download/:token` validates the signature and expiry and streams
 * the file. Links stored in chat history go stale after the TTL — a fresh
 * token is re-issued on next access — and tokens without an expiry are
 * rejected outright so no link is valid forever.
 */

function getSecret(): string {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "DOWNLOAD_SIGNING_SECRET must be set. " +
        "Generate a strong random value (e.g. `openssl rand -hex 32`) and set it in the environment.",
    );
  }
  return secret;
}

export function signDownload(path: string, filename: string): string {
  return signDownloadPayload({ path, filename }, getSecret());
}

export function verifyDownload(
  token: string,
): { path: string; filename: string } | null {
  return verifyDownloadPayload(token, getSecret());
}

/**
 * Returns a relative download URL (e.g. "/download/abc.def"). The frontend
 * prefixes it with NEXT_PUBLIC_API_BASE_URL when rendering `<a href=…>`.
 */
export function buildDownloadUrl(path: string, filename: string): string {
  return `/download/${signDownload(path, filename)}`;
}
