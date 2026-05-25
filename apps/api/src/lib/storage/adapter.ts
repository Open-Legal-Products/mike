/**
 * Contract every storage backend must implement.
 *
 * The default adapter is R2StorageAdapter (Cloudflare R2 / S3-compatible).
 * Swap it at application startup via setStorageAdapter() from lib/storage.ts:
 *
 *   import { setStorageAdapter } from "./lib/storage";
 *   import { SupabaseStorageAdapter } from "./my-adapters/supabase";
 *   setStorageAdapter(new SupabaseStorageAdapter());
 *
 * Implementing the interface is sufficient for full compatibility — no other
 * file needs to change.
 */
export interface StorageAdapter {
    /** True when the adapter is fully configured and ready to use. */
    readonly enabled: boolean;

    /** Upload content at key with the given MIME type. */
    upload(key: string, content: ArrayBuffer, contentType: string): Promise<void>;

    /** Download content at key, or null if absent or storage is disabled. */
    download(key: string): Promise<ArrayBuffer | null>;

    /** Delete the object at key.  No-ops if storage is disabled. */
    delete(key: string): Promise<void>;

    /**
     * Generate a pre-signed URL for temporary direct access to key.
     * Returns null if storage is disabled or the operation fails.
     *
     * @param key            Storage object key.
     * @param expiresIn      TTL in seconds (default 3600).
     * @param downloadFilename  Sets Content-Disposition on the response so
     *                          browsers use this filename on download.
     */
    getSignedUrl(
        key: string,
        expiresIn?: number,
        downloadFilename?: string,
    ): Promise<string | null>;

    /**
     * Health-check the storage backend.
     * Returns ok:true with latency when reachable, ok:false with error otherwise.
     */
    checkReady(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}
