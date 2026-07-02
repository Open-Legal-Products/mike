/**
 * Shared guarded-egress helpers for the cloud DMS adapters.
 *
 * EVERY outbound request goes through `guardedFetch` (lib/mcp/client.ts): it is
 * HTTPS-only, runs the private-IP SSRF check (`validateRemoteMcpUrl` via
 * lib/privateIp.ts `isBlockedIp`), pins the connection to the connect-time
 * validated address (no DNS-rebinding/TOCTOU window), and refuses to auto-follow
 * redirects (`redirect: "manual"`) so a 3xx to an internal host cannot smuggle
 * egress past the guard. iManage/NetDocuments are public SaaS, so they clear the
 * private-IP guard but still gain the TLS/redirect/pinning protections.
 *
 * A DMS content endpoint that legitimately 3xx-redirects to a CDN would surface
 * as a non-2xx here; the caller must follow it explicitly and re-validate the
 * target rather than the guard being relaxed (see the risks note in the spec).
 */
import { guardedFetch } from "../mcp/client";
import { MAX_UPLOAD_SIZE_BYTES } from "../upload";

function authHeaders(token: string, extra?: Record<string, string>) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(extra ?? {}),
    };
}

/** GET/POST a JSON endpoint through the guarded fetch and parse the body. */
export async function dmsJson(
    url: string,
    token: string,
    init?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
    },
): Promise<Record<string, unknown>> {
    const response = await guardedFetch(url, {
        method: init?.method ?? "GET",
        headers: authHeaders(token, {
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...(init?.headers ?? {}),
        }),
        ...(init?.body ? { body: init.body } : {}),
    });
    if (!response.ok) {
        throw new Error(
            `DMS request to ${redact(url)} failed (${response.status}).`,
        );
    }
    const parsed = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`DMS response from ${redact(url)} was not an object.`);
    }
    return parsed as Record<string, unknown>;
}

/**
 * Download bytes from a DMS content endpoint, enforcing the same 100MB ceiling
 * as the upload pipeline (lib/upload.ts) so a large document cannot exhaust
 * memory when buffered as an ArrayBuffer.
 */
export async function dmsBytes(
    url: string,
    token: string,
): Promise<ArrayBuffer> {
    const response = await guardedFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(
            `DMS download from ${redact(url)} failed (${response.status}).`,
        );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared && declared > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error(
            `DMS document exceeds the ${MAX_UPLOAD_SIZE_BYTES}-byte limit.`,
        );
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error(
            `DMS document exceeds the ${MAX_UPLOAD_SIZE_BYTES}-byte limit.`,
        );
    }
    return buf;
}

/** POST raw bytes (a new document version) through the guarded fetch. */
export async function dmsPostBytes(
    url: string,
    token: string,
    content: ArrayBuffer,
    headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
    const response = await guardedFetch(url, {
        method: "POST",
        headers: authHeaders(token, {
            "Content-Type": "application/octet-stream",
            ...(headers ?? {}),
        }),
        body: Buffer.from(content),
    });
    if (!response.ok) {
        throw new Error(
            `DMS export to ${redact(url)} failed (${response.status}).`,
        );
    }
    const parsed = await response.json().catch(() => ({}));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
}

/** Strip query strings from a URL before it reaches a log/error message. */
function redact(url: string): string {
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch {
        return "the DMS endpoint";
    }
}

/** Best-effort mapping of a DMS content type / filename to Mike's file_type. */
export function normalizeExtension(
    name: string | null | undefined,
    contentType: string | null | undefined,
): string {
    const fromName = (name ?? "").toLowerCase().match(/\.(pdf|docx|doc)$/)?.[1];
    if (fromName) return fromName;
    const ct = (contentType ?? "").toLowerCase();
    if (ct.includes("pdf")) return "pdf";
    if (ct.includes("wordprocessingml")) return "docx";
    if (ct.includes("msword")) return "doc";
    return "pdf";
}
