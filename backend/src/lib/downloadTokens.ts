import {
  signDownloadPayload,
  verifyDownloadPayload,
} from "../core/downloadTokens";

/**
 * HMAC-signed download tokens with an expiry (30 days by default).
 *
 * The token encodes the R2 storage path + filename + expiry; the backend
 * route `/download/:token` validates the signature and expiry and streams
 * the file. All newly issued tokens carry an expiry, and expired tokens are
 * rejected. Legacy tokens issued before expiry existed (no `e` claim, but
 * still HMAC-verified) are accepted transitionally so historical download
 * links persisted in chat messages keep working — see
 * core/downloadTokens.ts for the policy details.
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
