import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";
import { buildContentDisposition } from "../../core/storagePaths";
import type { StorageAdapter } from "./adapter";

/**
 * Cloudflare R2 (S3-compatible) implementation of StorageAdapter.
 *
 * Required env vars:
 *   R2_ENDPOINT_URL       — https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID      — R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY  — R2 API token (Secret Access Key)
 *   R2_BUCKET_NAME        — bucket name (default: "mike")
 *
 * The S3Client is lazily created and cached (singleton per adapter instance)
 * to enable HTTP keep-alive connection reuse across requests.
 */
export class R2StorageAdapter implements StorageAdapter {
    readonly enabled: boolean;
    private readonly bucket: string;
    private _client: S3Client | undefined;

    constructor() {
        this.enabled = Boolean(
            env.R2_ENDPOINT_URL &&
            env.R2_ACCESS_KEY_ID &&
            env.R2_SECRET_ACCESS_KEY,
        );
        this.bucket = env.R2_BUCKET_NAME;
    }

    private client(): S3Client {
        if (!this._client) {
            this._client = new S3Client({
                region: "auto",
                endpoint: env.R2_ENDPOINT_URL!,
                forcePathStyle: true,
                credentials: {
                    accessKeyId: env.R2_ACCESS_KEY_ID!,
                    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
                },
            });
        }
        return this._client;
    }

    private requireEnabled(): void {
        if (!this.enabled) {
            throw new Error(
                "R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
            );
        }
    }

    async upload(key: string, content: ArrayBuffer, contentType: string): Promise<void> {
        this.requireEnabled();
        await this.client().send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: Buffer.from(content),
                ContentType: contentType,
            }),
        );
    }

    async download(key: string): Promise<ArrayBuffer | null> {
        if (!this.enabled) return null;
        try {
            const response = await this.client().send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            if (!response.Body) return null;
            const bytes = await response.Body.transformToByteArray();
            return bytes.buffer as ArrayBuffer;
        } catch {
            return null;
        }
    }

    async delete(key: string): Promise<void> {
        if (!this.enabled) return;
        await this.client().send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
    }

    async getSignedUrl(
        key: string,
        expiresIn = 3600,
        downloadFilename?: string,
    ): Promise<string | null> {
        if (!this.enabled) return null;
        try {
            const responseContentDisposition = downloadFilename
                ? buildContentDisposition("attachment", downloadFilename)
                : undefined;
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ResponseContentDisposition: responseContentDisposition,
            });
            return await awsGetSignedUrl(this.client(), command, { expiresIn });
        } catch {
            return null;
        }
    }

    async checkReady(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
        if (!this.enabled) {
            return { ok: false, error: "storage is not configured" };
        }
        const startedAt = Date.now();
        try {
            await this.client().send(new HeadBucketCommand({ Bucket: this.bucket }));
            return { ok: true, latencyMs: Date.now() - startedAt };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, latencyMs: Date.now() - startedAt, error: message };
        }
    }
}
