import { Storage } from "@google-cloud/storage";
import { env } from "../env";
import { buildContentDisposition } from "../../core/storagePaths";
import type { StorageAdapter } from "./adapter";

/**
 * Google Cloud Storage implementation of StorageAdapter.
 *
 * Auth is resolved via Application Default Credentials (ADC) — the standard
 * GCP credential chain that covers:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var (path to a service account JSON key)
 *   - Workload Identity (GKE, Cloud Run, Compute Engine)
 *   - gcloud CLI credentials (local development: `gcloud auth application-default login`)
 *
 * Required env vars:
 *   GCS_BUCKET_NAME   — bucket name (default: "mike")
 *   GCS_PROJECT_ID    — GCP project id (optional when running on GCP with ADC)
 *
 * Signed URL generation uses ADC automatically on GCP runtimes that support
 * service account impersonation (Cloud Run, GKE with Workload Identity).
 * For local development with a key file, set GOOGLE_APPLICATION_CREDENTIALS.
 *
 * To use GCS instead of R2, call setStorageAdapter() at application startup:
 *
 *   import { setStorageAdapter } from "./lib/storage";
 *   import { GCSStorageAdapter } from "./lib/storage/gcs";
 *   setStorageAdapter(new GCSStorageAdapter());
 */
export class GCSStorageAdapter implements StorageAdapter {
    readonly enabled: boolean;
    private readonly bucket: string;
    private _storage: Storage | undefined;

    constructor() {
        // Enabled when a GCS project or ADC is available.
        // We treat presence of GCS_PROJECT_ID or GOOGLE_APPLICATION_CREDENTIALS
        // as the intent-to-use signal, similar to R2_ENDPOINT_URL for R2.
        this.enabled = Boolean(env.GCS_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS);
        this.bucket = env.GCS_BUCKET_NAME;
    }

    private storage(): Storage {
        if (!this._storage) {
            this._storage = new Storage({
                ...(env.GCS_PROJECT_ID ? { projectId: env.GCS_PROJECT_ID } : {}),
            });
        }
        return this._storage;
    }

    private requireEnabled(): void {
        if (!this.enabled) {
            throw new Error(
                "GCS is not configured. Set GCS_PROJECT_ID or GOOGLE_APPLICATION_CREDENTIALS.",
            );
        }
    }

    async upload(key: string, content: ArrayBuffer, contentType: string): Promise<void> {
        this.requireEnabled();
        const file = this.storage().bucket(this.bucket).file(key);
        await file.save(Buffer.from(content), {
            metadata: { contentType },
            resumable: false,
        });
    }

    async download(key: string): Promise<ArrayBuffer | null> {
        if (!this.enabled) return null;
        try {
            const [contents] = await this.storage().bucket(this.bucket).file(key).download();
            return contents.buffer.slice(
                contents.byteOffset,
                contents.byteOffset + contents.byteLength,
            ) as ArrayBuffer;
        } catch {
            return null;
        }
    }

    async delete(key: string): Promise<void> {
        if (!this.enabled) return;
        try {
            await this.storage().bucket(this.bucket).file(key).delete();
        } catch {
            // Ignore not-found errors on delete (idempotent)
        }
    }

    async getSignedUrl(
        key: string,
        expiresIn = env.GCS_SIGNED_URL_TTL,
        downloadFilename?: string,
    ): Promise<string | null> {
        if (!this.enabled) return null;
        try {
            const file = this.storage().bucket(this.bucket).file(key);
            const responseDisposition = downloadFilename
                ? buildContentDisposition("attachment", downloadFilename)
                : undefined;

            const [url] = await file.getSignedUrl({
                version: "v4",
                action: "read",
                expires: Date.now() + expiresIn * 1000,
                ...(responseDisposition
                    ? { responseDisposition }
                    : {}),
            });
            return url;
        } catch {
            return null;
        }
    }

    async checkReady(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
        if (!this.enabled) {
            return { ok: false, error: "GCS is not configured" };
        }
        const startedAt = Date.now();
        try {
            const [exists] = await this.storage().bucket(this.bucket).exists();
            if (!exists) {
                return {
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: `Bucket "${this.bucket}" does not exist`,
                };
            }
            return { ok: true, latencyMs: Date.now() - startedAt };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, latencyMs: Date.now() - startedAt, error: message };
        }
    }
}
