/**
 * Storage public API.
 *
 * The default backend is Cloudflare R2 (S3-compatible).  To swap it for
 * Supabase Storage, local filesystem, AWS S3, or any other backend, implement
 * StorageAdapter (lib/storage/adapter.ts) and call setStorageAdapter() early
 * in your application bootstrap — before the first upload/download call:
 *
 *   import { setStorageAdapter } from "./lib/storage";
 *   import { SupabaseStorageAdapter } from "./my-adapters/supabase";
 *   setStorageAdapter(new SupabaseStorageAdapter());
 *
 * All existing callers of uploadFile / downloadFile / deleteFile / getSignedUrl
 * / checkStorageReady continue to work unchanged — they delegate to whichever
 * adapter is currently installed.
 *
 * Required env vars for the default R2 adapter:
 *   R2_ENDPOINT_URL       — https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID      — R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY  — R2 API token (Secret Access Key)
 *   R2_BUCKET_NAME        — bucket name (default: "mike")
 */

import type { StorageAdapter } from "./storage/adapter";
import { R2StorageAdapter } from "./storage/r2";
import { env } from "./env";

// Re-export the interface and default implementation so callers can build
// alternative adapters without needing to know the internal file layout.
export type { StorageAdapter } from "./storage/adapter";
export { R2StorageAdapter } from "./storage/r2";
export { GCSStorageAdapter } from "./storage/gcs";

// Path / filename utilities are pure functions with no I/O; they live in
// core/ and are re-exported here for convenience.
export {
  normalizeDownloadFilename,
  sanitizeDispositionFilename,
  encodeRFC5987,
  buildContentDisposition,
  storageKey,
  pdfStorageKey,
  generatedDocKey,
  versionStorageKey,
} from "../core/storagePaths";

// ---------------------------------------------------------------------------
// Adapter singleton
// ---------------------------------------------------------------------------

let _adapter: StorageAdapter | undefined;

function getAdapter(): StorageAdapter {
  if (!_adapter) {
    _adapter = new R2StorageAdapter();
  }
  return _adapter;
}

/**
 * Replace the active storage adapter.
 *
 * Must be called before the first storage operation (upload, download, etc.).
 * Subsequent calls replace the adapter for all future operations.
 */
export function setStorageAdapter(adapter: StorageAdapter): void {
  _adapter = adapter;
}

// Evaluated once at module load — reflects whether the default R2 adapter is
// configured.  If you install a different adapter via setStorageAdapter(),
// call adapter.enabled instead of reading this export.
export const storageEnabled = Boolean(
  env.R2_ENDPOINT_URL &&
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY,
);

// ---------------------------------------------------------------------------
// Storage operations — delegate to the active adapter
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  return getAdapter().upload(key, content, contentType);
}

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  return getAdapter().download(key);
}

export async function deleteFile(key: string): Promise<void> {
  return getAdapter().delete(key);
}

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  return getAdapter().getSignedUrl(key, expiresIn, downloadFilename);
}

export async function listFiles(prefix: string): Promise<string[]> {
  return getAdapter().list(prefix);
}

export async function checkStorageReady(): Promise<{
  ok: boolean;
  latencyMs?: number;
  error?: string;
}> {
  return getAdapter().checkReady();
}
