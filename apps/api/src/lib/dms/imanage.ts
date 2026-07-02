/**
 * iManage Work adapter (OAuth2 auth-code + refresh, iManage Work REST /api/v2).
 *
 * All egress routes through the shared guarded-fetch helpers (lib/dms/http.ts →
 * lib/mcp/client.ts `guardedFetch`), so the connector inherits the MCP SSRF
 * hardening unchanged.
 *
 * LIVE TENANT VALIDATION REQUIRED: the endpoint paths, response envelopes, and
 * version-numbering below are best-effort from public iManage Work API docs
 * (/api/v2 with customer-id + library scoping). They are proven only against
 * the mocked HTTP contracts in __tests__/imanage.test.ts. Confirming them
 * against a real tenant — which needs OAuth client credentials, the tenant base
 * URL, and a customer id + library id — is an operator acceptance step.
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

export class IManageAdapter implements DmsConnector {
    public readonly kind: DmsKind = "imanage";

    private readonly baseUrl: string;
    private readonly customerId: string;
    private readonly library: string;
    private readonly getAccessToken: () => Promise<string>;

    constructor(config: DmsAdapterConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.customerId = String(config.customerId ?? "");
        this.library = String(config.library ?? "");
        this.getAccessToken =
            config.getAccessToken ??
            (() => {
                throw new Error(
                    "iManage connector has no OAuth token provider configured.",
                );
            });
    }

    // Enabled only when we have both a base URL and the customer/library scope
    // iManage Work requires to address any resource.
    public get enabled(): boolean {
        return Boolean(this.baseUrl && this.customerId && this.library);
    }

    /** {baseUrl}/api/v2/customers/{customerId}/libraries/{library} */
    private root(): string {
        return `${this.baseUrl}/api/v2/customers/${encodeURIComponent(
            this.customerId,
        )}/libraries/${encodeURIComponent(this.library)}`;
    }

    async authenticate(): Promise<DmsAuthResult> {
        if (!this.enabled) {
            return { ok: false, error: "iManage connector is not configured." };
        }
        try {
            const token = await this.getAccessToken();
            // A cheap, read-only probe: list the library's top-level workspaces.
            await dmsJson(`${this.root()}/workspaces?limit=1`, token);
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
        // Top-level = the library's workspaces; deeper = a folder's children.
        const url = parentId
            ? `${this.root()}/folders/${encodeURIComponent(parentId)}/children`
            : `${this.root()}/workspaces`;
        const body = await dmsJson(url, token);
        return asArray(body.data).map((row) => ({
            id: String(row.id ?? row.wstype ?? ""),
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
        const params = new URLSearchParams({
            q: query,
            limit: String(limit),
        });
        if (opts.folderId) params.set("folder_id", opts.folderId);
        const body = await dmsJson(
            `${this.root()}/documents/search?${params.toString()}`,
            token,
        );
        return asArray(body.data).map((row) => ({
            id: String(row.id ?? ""),
            name: str(row.name) ?? String(row.id ?? ""),
            folderId: str(row.folder_id),
            contentType: str(row.mime),
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
                `${this.root()}/documents/${encodeURIComponent(docId)}`,
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
            `${this.root()}/documents/${encodeURIComponent(docId)}/download`,
            token,
        );
        const name = str(meta.name) ?? docId;
        const extension = normalizeExtension(
            str(meta.extension) ? `${name}.${String(meta.extension)}` : name,
            str(meta.mime),
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
                contentType: str(meta.mime) ?? "application/octet-stream",
                extension,
                sizeBytes:
                    typeof meta.size === "number"
                        ? meta.size
                        : content.byteLength,
                folderId: str(meta.folder_id),
                author: str(meta.author),
                updatedAt: str(meta.edit_date) ?? str(meta.update_date),
            },
        };
    }

    async exportDocument(
        docId: string,
        content: ArrayBuffer,
        opts: DmsExportOptions = {},
    ): Promise<DmsExportResult> {
        if (!this.enabled) {
            throw new Error("iManage connector is not configured.");
        }
        const token = await this.getAccessToken();
        // iManage models a round-trip write as a NEW version on the document.
        // newVersion defaults to true; an in-place overwrite would target
        // /documents/{id}/update, which we intentionally do not do by default
        // to preserve the DMS audit trail.
        const url =
            opts.newVersion === false
                ? `${this.root()}/documents/${encodeURIComponent(docId)}/update`
                : `${this.root()}/documents/${encodeURIComponent(docId)}/versions`;
        const body = await dmsPostBytes(url, token, content, {
            ...(opts.filename
                ? { "X-Document-Name": opts.filename }
                : {}),
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
