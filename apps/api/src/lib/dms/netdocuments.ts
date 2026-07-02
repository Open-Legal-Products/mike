/**
 * NetDocuments adapter (OAuth2 /v1/OAuth, REST /v2 cabinets/folders/search +
 * document content + AddVersion).
 *
 * All egress routes through the shared guarded-fetch helpers (lib/dms/http.ts →
 * lib/mcp/client.ts `guardedFetch`), so the connector inherits the MCP SSRF
 * hardening unchanged.
 *
 * LIVE TENANT VALIDATION REQUIRED: the endpoint paths, response envelopes, and
 * version semantics below are best-effort from public NetDocuments REST API
 * docs (/v2 with cabinet/repository routing). They are proven only against the
 * mocked HTTP contracts in __tests__/netdocuments.test.ts. Confirming them
 * against a real tenant — which needs OAuth client credentials, the tenant base
 * URL, and a cabinet id — is an operator acceptance step.
 */
import type {
    DmsAdapterConfig,
    DmsAuthResult,
    DmsConnector,
    DmsDocument,
    DmsExportOptions,
    DmsExportResult,
    DmsFolder,
    DmsKind,
    DmsSearchOptions,
    DmsSearchResult,
} from "./adapter";
import { DMS_SEARCH_LIMIT } from "./types";
import { dmsBytes, dmsJson, dmsPostBytes, normalizeExtension } from "./http";

function asArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    return [];
}

function str(value: unknown): string | null {
    return typeof value === "string" && value.length ? value : null;
}

export class NetDocumentsAdapter implements DmsConnector {
    public readonly kind: DmsKind = "netdocuments";

    private readonly baseUrl: string;
    private readonly cabinet: string;
    private readonly getAccessToken: () => Promise<string>;

    constructor(config: DmsAdapterConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        // NetDocuments routes by cabinet ("repository"); accept either config key.
        this.cabinet = String(config.repository ?? config.library ?? "");
        this.getAccessToken =
            config.getAccessToken ??
            (() => {
                throw new Error(
                    "NetDocuments connector has no OAuth token provider configured.",
                );
            });
    }

    public get enabled(): boolean {
        return Boolean(this.baseUrl && this.cabinet);
    }

    private v2(): string {
        return `${this.baseUrl}/v2`;
    }

    async authenticate(): Promise<DmsAuthResult> {
        if (!this.enabled) {
            return {
                ok: false,
                error: "NetDocuments connector is not configured.",
            };
        }
        try {
            const token = await this.getAccessToken();
            // Read-only probe: the cabinet's info endpoint.
            await dmsJson(
                `${this.v2()}/cabinet/${encodeURIComponent(this.cabinet)}/info`,
                token,
            );
            return { ok: true };
        } catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async listFolders(parentId?: string | null): Promise<DmsFolder[]> {
        if (!this.enabled) return [];
        const token = await this.getAccessToken();
        const url = parentId
            ? `${this.v2()}/folder/${encodeURIComponent(parentId)}/content?type=folder`
            : `${this.v2()}/cabinet/${encodeURIComponent(this.cabinet)}/folders`;
        const body = await dmsJson(url, token);
        // NetDocuments returns either { results: [...] } or a bare array.
        const rows = asArray(body.results).length
            ? asArray(body.results)
            : asArray(body.data);
        return rows.map((row) => ({
            id: String(row.id ?? row.envId ?? ""),
            name: str(row.name) ?? String(row.id ?? ""),
            parentId: parentId ?? null,
        }));
    }

    async search(
        query: string,
        opts: DmsSearchOptions = {},
    ): Promise<DmsSearchResult[]> {
        if (!this.enabled) return [];
        const token = await this.getAccessToken();
        const limit = Math.min(opts.limit ?? DMS_SEARCH_LIMIT, DMS_SEARCH_LIMIT);
        const params = new URLSearchParams({ q: query, max: String(limit) });
        if (opts.folderId) params.set("folder", opts.folderId);
        const body = await dmsJson(
            `${this.v2()}/search/${encodeURIComponent(this.cabinet)}?${params.toString()}`,
            token,
        );
        const rows = asArray(body.results).length
            ? asArray(body.results)
            : asArray(body.data);
        return rows.map((row) => ({
            id: String(row.id ?? row.envId ?? ""),
            name: str(row.name) ?? String(row.id ?? ""),
            folderId: str(row.folderId),
            contentType: str(row.ext) ? `application/${row.ext}` : null,
            version:
                row.version !== undefined && row.version !== null
                    ? String(row.version)
                    : null,
        }));
    }

    async fetchDocument(docId: string): Promise<DmsDocument | null> {
        if (!this.enabled) return null;
        const token = await this.getAccessToken();
        let meta: Record<string, unknown>;
        try {
            const body = await dmsJson(
                `${this.v2()}/document/${encodeURIComponent(docId)}/info`,
                token,
            );
            meta =
                body.data && typeof body.data === "object"
                    ? (body.data as Record<string, unknown>)
                    : body;
        } catch {
            return null;
        }
        const content = await dmsBytes(
            `${this.v2()}/document/${encodeURIComponent(docId)}/content`,
            token,
        );
        const name =
            str(meta.name) ??
            (str(meta.ext) ? `${docId}.${String(meta.ext)}` : docId);
        const extension = normalizeExtension(
            str(meta.ext) ? `${name}.${String(meta.ext)}` : name,
            null,
        );
        const version =
            meta.version !== undefined && meta.version !== null
                ? String(meta.version)
                : "1";
        return {
            content,
            version,
            metadata: {
                id: str(meta.id) ?? docId,
                name,
                contentType: str(meta.ext)
                    ? `application/${String(meta.ext)}`
                    : "application/octet-stream",
                extension,
                sizeBytes:
                    typeof meta.size === "number"
                        ? meta.size
                        : content.byteLength,
                folderId: str(meta.folderId),
                author: str(meta.author),
                updatedAt: str(meta.lastMod) ?? str(meta.modified),
            },
        };
    }

    async exportDocument(
        docId: string,
        content: ArrayBuffer,
        opts: DmsExportOptions = {},
    ): Promise<DmsExportResult> {
        if (!this.enabled) {
            throw new Error("NetDocuments connector is not configured.");
        }
        const token = await this.getAccessToken();
        // NetDocuments' round-trip write is "AddVersion". An in-place overwrite
        // would PUT the content endpoint; we default to AddVersion to preserve
        // the DMS version history.
        const url =
            opts.newVersion === false
                ? `${this.v2()}/document/${encodeURIComponent(docId)}/content`
                : `${this.v2()}/document/${encodeURIComponent(docId)}/version`;
        const body = await dmsPostBytes(url, token, content, {
            ...(opts.filename ? { "X-Document-Name": opts.filename } : {}),
        });
        const data =
            body.data && typeof body.data === "object"
                ? (body.data as Record<string, unknown>)
                : body;
        const version =
            data.version !== undefined && data.version !== null
                ? String(data.version)
                : "unknown";
        return { docId, version };
    }

    async checkReady() {
        const started = Date.now();
        const result = await this.authenticate();
        return result.ok
            ? { ok: true, latencyMs: Date.now() - started }
            : { ok: false, error: result.error };
    }
}
