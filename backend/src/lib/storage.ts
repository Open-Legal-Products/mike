/**
 * S3-compatible storage utilities for Mike document management.
 * Supports AWS S3, Cloudflare R2, MinIO and other S3-compatible stores.
 *
 * Env vars (S3_* preferred; R2_* kept for upstream compatibility):
 *   S3_ENDPOINT_URL      — optional endpoint for S3-compatible stores (MinIO, R2)
 *   S3_ACCESS_KEY_ID     — access key ID
 *   S3_SECRET_ACCESS_KEY — secret access key
 *   S3_BUCKET_NAME       — bucket name
 *   S3_REGION            — region (default: us-east-1)
 *
 * Fallback to legacy R2_* variables if S3_* are not set.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import * as S3Commands from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

const GetObjectCommand = (S3Commands as any).GetObjectCommand;

function endpointUrl(): string | undefined {
  return process.env.S3_ENDPOINT_URL || process.env.R2_ENDPOINT_URL;
}

function accessKeyId(): string | undefined {
  return process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
}

function secretAccessKey(): string | undefined {
  return process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
}

function bucketName(): string {
  return process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME || "mike";
}

function region(): string {
  return process.env.S3_REGION || "us-east-1";
}

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    const endpoint = endpointUrl();
    cachedClient = new S3Client({
      region: region(),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: accessKeyId()!,
        secretAccessKey: secretAccessKey()!,
      },
    });
  }
  return cachedClient;
}

const BUCKET = bucketName();

export const storageEnabled = Boolean(
  endpointUrl() && accessKeyId() && secretAccessKey(),
);

export async function checkStorageConnectivity(): Promise<boolean> {
  if (!storageEnabled) return false;
  try {
    const client = getClient();
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch (err: any) {
    if (err && err.name === "NotFound") {
      // Bucket does not exist, but service responded — connection works.
      return false;
    }
    return false;
  }
}

function requireStorageConfig(): void {
  if (!storageEnabled) {
    throw new Error(
      "S3_ENDPOINT_URL (or R2_ENDPOINT_URL), S3_ACCESS_KEY_ID (or R2_ACCESS_KEY_ID), and S3_SECRET_ACCESS_KEY (or R2_SECRET_ACCESS_KEY) must be set",
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
    const response = (await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    )) as any;
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  if (!storageEnabled) return [];
  const client = getClient();
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    ContinuationToken = response.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
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
    const responseContentDisposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    }) as any;
    return await awsGetSignedUrl(client, command, { expiresIn });
  } catch {
    return null;
  }
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
// Storage key helpers
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
