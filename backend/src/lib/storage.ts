/**
 * Storage layer for Mike document management.
 *
 * Backends (in priority order):
 *   1. Cloudflare R2 (S3-compatible) — when R2_* env vars are set
 *   2. Supabase Storage              — when R2 is absent and Supabase is configured
 *   3. Local filesystem              — default, always available
 *
 * R2 env vars:
 *   R2_ENDPOINT_URL       — https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID      — R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY  — R2 API token (Secret Access Key)
 *   R2_BUCKET_NAME        — bucket name (default: "mike")
 *
 * Supabase Storage (automatic fallback when R2 is absent):
 *   SUPABASE_URL / SUPABASE_SECRET_KEY (already required for auth)
 *   SUPABASE_STORAGE_BUCKET — bucket name (default: "mike-documents")
 *
 * Local filesystem (default when no cloud storage is configured):
 *   LOCAL_STORAGE_PATH — directory for stored files (default: "./uploads")
 *   BACKEND_URL        — used to build signed URLs (default: "http://localhost:3001")
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import { signLocalFile } from "./localSignedTokens";

// ---------------------------------------------------------------------------
// Driver detection
// ---------------------------------------------------------------------------

function isR2Configured(): boolean {
  const url = process.env.R2_ENDPOINT_URL?.trim() ?? "";
  const key = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secret = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  // Reject placeholder values shipped with .env.example
  if (url.includes("your-account-id") || key.startsWith("your-") || secret.startsWith("your-")) return false;
  return Boolean(url && key && secret);
}

const USE_R2 = isR2Configured();
// Supabase Storage requires an explicit opt-in via SUPABASE_STORAGE_BUCKET,
// because SUPABASE_URL/SUPABASE_SECRET_KEY are also used for Auth and would
// otherwise accidentally enable cloud storage.
const USE_SUPABASE_STORAGE = !USE_R2 && Boolean(
  process.env.SUPABASE_STORAGE_BUCKET?.trim(),
);
const USE_LOCAL = !USE_R2 && !USE_SUPABASE_STORAGE;

const BUCKET = process.env.R2_BUCKET_NAME ?? "mike";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "mike-documents";
const LOCAL_STORAGE_PATH = path.resolve(
  process.env.LOCAL_STORAGE_PATH ?? "./uploads",
);
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");

// Storage is always enabled (local filesystem is always available).
export const storageEnabled = true;

if (USE_LOCAL) {
  // Ensure the local storage directory exists at startup.
  fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// R2 client
// ---------------------------------------------------------------------------

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// ---------------------------------------------------------------------------
// Supabase Storage client
// ---------------------------------------------------------------------------

function getSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

async function ensureSupabaseBucket(): Promise<void> {
  const sb = getSupabaseClient();
  const { data: buckets } = await sb.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === SUPABASE_BUCKET);
  if (!exists) {
    await sb.storage.createBucket(SUPABASE_BUCKET, { public: false });
  }
}

let bucketEnsured = false;
async function withBucket(): Promise<ReturnType<typeof getSupabaseClient>> {
  const sb = getSupabaseClient();
  if (!bucketEnsured) {
    await ensureSupabaseBucket();
    bucketEnsured = true;
  }
  return sb;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (USE_R2) {
    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: Buffer.from(content),
        ContentType: contentType,
      }),
    );
    return;
  }

  if (USE_SUPABASE_STORAGE) {
    const sb = await withBucket();
    const { error } = await sb.storage
      .from(SUPABASE_BUCKET)
      .upload(key, Buffer.from(content), { contentType, upsert: true });
    if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
    return;
  }

  // Local filesystem
  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(content));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  try {
    if (USE_R2) {
      const client = getR2Client();
      const response = await client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      );
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return bytes.buffer as ArrayBuffer;
    }

    if (USE_SUPABASE_STORAGE) {
      const sb = await withBucket();
      const { data, error } = await sb.storage.from(SUPABASE_BUCKET).download(key);
      if (error || !data) return null;
      return await data.arrayBuffer();
    }

    // Local filesystem
    const filePath = path.join(LOCAL_STORAGE_PATH, key);
    const buf = await fs.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  if (USE_R2) {
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return;
  }

  if (USE_SUPABASE_STORAGE) {
    const sb = await withBucket();
    await sb.storage.from(SUPABASE_BUCKET).remove([key]);
    return;
  }

  // Local filesystem
  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  await fs.unlink(filePath).catch(() => {});
}

// ---------------------------------------------------------------------------
// Signed URL (pre-signed for temporary direct access)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  try {
    if (USE_R2) {
      const client = getR2Client();
      const responseContentDisposition = downloadFilename
        ? buildContentDisposition("attachment", downloadFilename)
        : undefined;
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentDisposition: responseContentDisposition,
      });
      return await awsGetSignedUrl(client, command, { expiresIn });
    }

    if (USE_SUPABASE_STORAGE) {
      const sb = await withBucket();
      const { data, error } = await sb.storage
        .from(SUPABASE_BUCKET)
        .createSignedUrl(key, expiresIn, {
          download: downloadFilename ? normalizeDownloadFilename(downloadFilename) : false,
        });
      if (error || !data) return null;
      return data.signedUrl;
    }

    // Local filesystem: generate a time-limited HMAC token served by /local-files
    const filename = downloadFilename ?? path.basename(key);
    const token = signLocalFile(key, filename, expiresIn);
    return `${BACKEND_URL}/local-files/${token}`;
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

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function activeStorageBackend(): "r2" | "supabase" | "local" {
  if (USE_R2) return "r2";
  if (USE_SUPABASE_STORAGE) return "supabase";
  return "local";
}
