/**
 * Local on-disk file storage for Mike document management.
 *
 * Drop-in replacement for the previous Cloudflare R2 / S3 backend: same
 * exported functions and signatures, so no calling code changed. Files are
 * stored under an `uploads/` directory in the backend, keyed by the same
 * "documents/<user>/<doc>/…" paths that were used as R2 object keys.
 *
 * Env vars:
 *   UPLOAD_DIR        — override the storage directory (default: backend/uploads)
 *   PUBLIC_BASE_URL   — backend's externally reachable base URL, used to build
 *                       absolute download links (default: http://localhost:<PORT>)
 */

import fs from "fs/promises";
import path from "path";
import { buildDownloadUrl } from "./downloadTokens";

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");

// Local disk is always available — no external service to configure.
export const storageEnabled = true;

function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT ?? 3001}`
  );
}

/**
 * Map a storage key to an absolute path inside UPLOAD_DIR, guarding against
 * path traversal. Keys are generated internally (see the *Key helpers below)
 * so this is belt-and-suspenders.
 */
function resolveKeyPath(key: string): string {
  const normalized = path
    .normalize(key)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");
  const full = path.resolve(UPLOAD_DIR, normalized);
  if (full !== UPLOAD_DIR && !full.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return full;
}

/** Ensure the base uploads directory exists. Called on startup. */
export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  _contentType: string,
): Promise<void> {
  const filePath = resolveKeyPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(content));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  try {
    const filePath = resolveKeyPath(key);
    const buf = await fs.readFile(filePath);
    return buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  const keys: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        // Reconstruct the forward-slash storage key relative to UPLOAD_DIR.
        const key = path.relative(UPLOAD_DIR, abs).split(path.sep).join("/");
        if (key.startsWith(prefix)) keys.push(key);
      }
    }
  }

  await walk(UPLOAD_DIR);
  return keys;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKeyPath(key));
  } catch {
    // Already gone — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// "Signed" URL — locally this is just an HMAC-signed /download link served by
// the backend (see routes/downloads.ts). It streams the bytes with the right
// Content-Disposition, so the previous presigned-URL behaviour is preserved.
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  key: string,
  _expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  const filename =
    downloadFilename || normalizeDownloadFilename(key.split("/").pop() ?? "download");
  return `${publicBaseUrl()}${buildDownloadUrl(key, filename)}`;
}

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name)
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

// ---------------------------------------------------------------------------
// Storage key helpers (unchanged)
// ---------------------------------------------------------------------------

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
  userId: string,
  docId: string,
  stem: string,
): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
