/**
 * Cloudflare R2 storage utilities for Mike document management.
 * R2 is S3-compatible — uses @aws-sdk/client-s3.
 *
 * Required env vars:
 *   R2_ENDPOINT_URL     — https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID    — R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY — R2 API token (Secret Access Key)
 *   R2_BUCKET_NAME      — bucket name (default: "mike")
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

function getClient(): S3Client {
    return new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT_URL!,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID!,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
    });
}

const BUCKET = process.env.R2_BUCKET_NAME ?? "mike";

export const storageEnabled = Boolean(
    process.env.R2_ENDPOINT_URL &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
);

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
    key: string,
    content: ArrayBuffer,
    contentType: string,
): Promise<void> {
    const client = getClient();
    await client.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: Buffer.from(content),
            ContentType: contentType,
        }),
    );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
    if (!storageEnabled) return null;
    try {
        const client = getClient();
        const response = await client.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        if (!response.Body) return null;
        const bytes = await response.Body.transformToByteArray();
        return bytes.buffer as ArrayBuffer;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
    if (!storageEnabled) return;
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ---------------------------------------------------------------------------
// Signed URL (pre-signed for temporary direct access)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
    key: string,
    expiresIn = 3600,
): Promise<string | null> {
    if (!storageEnabled) return null;
    try {
        const client = getClient();
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        return await awsGetSignedUrl(client, command, { expiresIn });
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

export function storageKey(
    userId: string,
    docId: string,
    filename: string,
): string {
    return `documents/${userId}/${docId}/${filename}`;
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
    return `generated/${userId}/${docId}/${filename}`;
}
