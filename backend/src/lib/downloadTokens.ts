import {
  signDownloadPayload,
  verifyDownloadPayload,
} from "../core/downloadTokens";

/**
 * HMAC-signed, non-expiring download tokens.
 *
 * The token encodes the R2 storage path + filename; the backend route
 * `/download/:token` validates the signature and streams the file. This
 * gives persistent links safe to store in chat history without signed-URL
 * expiry or R2 CORS headaches.
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
