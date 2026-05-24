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
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
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
import { buildContentDisposition } from "../core/storagePaths";

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT_URL!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

const BUCKET = env.R2_BUCKET_NAME;

export const storageEnabled = Boolean(
  env.R2_ENDPOINT_URL &&
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY,
);

function requireStorageConfig(): void {
  if (!storageEnabled) {
    throw new Error(
      "R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
    );
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  requireStorageConfig();
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
  downloadFilename?: string,
): Promise<string | null> {
  if (!storageEnabled) return null;
  try {
    const client = getClient();
    // Override the response Content-Disposition so the browser uses this
    // filename on download, instead of the last path segment of the R2 key
    // (which includes the document UUID). The `download` attribute on <a>
    // is ignored for cross-origin URLs, so we have to set it server-side.
    const responseContentDisposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });
    return await awsGetSignedUrl(client, command, { expiresIn });
  } catch {
    return null;
  }
}

export async function checkStorageReady(): Promise<{
  ok: boolean;
  latencyMs?: number;
  error?: string;
}> {
  if (!storageEnabled) {
    return { ok: false, error: "storage is not configured" };
  }

  const startedAt = Date.now();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: Date.now() - startedAt, error: message };
  }
}
