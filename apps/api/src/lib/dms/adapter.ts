/**
 * Contract every Document Management System (DMS) connector must implement.
 *
 * This mirrors the StorageAdapter pluggability pattern (lib/storage/adapter.ts)
 * exactly: a small interface with a swappable registry (lib/dms/index.ts) so a
 * new DMS vendor can be added by implementing this interface and registering a
 * factory — no caller needs to change.
 *
 * The default adapter is FakeDMSAdapter (in-memory, deterministic, usable
 * air-gapped). The cloud adapters are iManageAdapter and NetDocumentsAdapter,
 * both isolated behind this interface and routing every outbound request
 * through the SSRF-guarded egress helper (lib/mcp/client.ts `guardedFetch`).
 *
 * Like StorageAdapter, methods return empty / null when the connector is
 * disabled rather than throwing, so callers degrade gracefully.
 *
 * NOTE: The iManage and NetDocuments adapters are validated in CI ONLY against
 * mocked HTTP transports (see the __tests__ folder). Endpoint paths, paging,
 * and version semantics are best-effort from public API docs — LIVE TENANT
 * VALIDATION requires real OAuth client credentials, a tenant base URL, and
 * library/cabinet IDs, and is an operator acceptance step, not a unit test.
 */

/** The set of DMS backends Mike knows how to talk to. */
export type DmsKind = "fake" | "imanage" | "netdocuments";

/** A folder (iManage folder / NetDocuments folder) in the DMS tree. */
export interface DmsFolder {
    id: string;
    name: string;
    /** Parent folder id, or null for a top-level container (library/cabinet). */
    parentId: string | null;
}

/** A single hit from a DMS search. */
export interface DmsSearchResult {
    id: string;
    name: string;
    folderId: string | null;
    /** MIME type when the DMS reports one. */
    contentType: string | null;
    /** Vendor version identifier of the matched document, when known. */
    version: string | null;
}

/** Metadata describing a fetched document, independent of vendor. */
export interface DmsDocumentMetadata {
    id: string;
    name: string;
    contentType: string;
    /** Normalized file extension ("pdf" | "docx" | "doc"). */
    extension: string;
    sizeBytes: number | null;
    folderId: string | null;
    author?: string | null;
    updatedAt?: string | null;
}

/** A document fetched from the DMS: raw bytes + metadata + vendor version. */
export interface DmsDocument {
    content: ArrayBuffer;
    metadata: DmsDocumentMetadata;
    /** Vendor version identifier the bytes were fetched at. */
    version: string;
}

export interface DmsSearchOptions {
    /** Restrict the search to a folder subtree when supported. */
    folderId?: string | null;
    /** Cap the number of results (adapters clamp to a sane maximum). */
    limit?: number;
}

export interface DmsExportOptions {
    /**
     * When true, push the content back as a NEW version of docId rather than
     * overwriting the current version. Both iManage and NetDocuments model this
     * as an explicit add-version operation.
     */
    newVersion?: boolean;
    /** Optional filename to record on the exported version. */
    filename?: string;
    contentType?: string;
}

/** Result of an export back to the DMS. */
export interface DmsExportResult {
    docId: string;
    /** Vendor version identifier the export produced. */
    version: string;
}

export interface DmsAuthResult {
    ok: boolean;
    error?: string;
}

/**
 * Configuration handed to an adapter factory. `getAccessToken` returns a fresh,
 * refreshed OAuth bearer token on demand (the real adapters call it per request
 * so a near-expiry token is transparently refreshed). The Fake adapter ignores
 * everything here.
 */
export interface DmsAdapterConfig {
    /** Tenant base URL (already SSRF-validated on save). */
    baseUrl: string;
    /** Resolves a valid OAuth access token for the current connector. */
    getAccessToken?: () => Promise<string>;
    /** iManage: customer id + library scoping. NetDocuments: cabinet id. */
    customerId?: string | null;
    library?: string | null;
    repository?: string | null;
}

export interface DmsConnector {
    /** Which backend this adapter talks to. */
    readonly kind: DmsKind;

    /** True when the adapter is fully configured and ready to use. */
    readonly enabled: boolean;

    /**
     * Validate that the configured credentials work against the DMS. Returns
     * ok:false with an error string rather than throwing on an auth failure.
     */
    authenticate(): Promise<DmsAuthResult>;

    /**
     * List folders under parentId (top-level containers when parentId is
     * omitted). Returns [] when the connector is disabled.
     */
    listFolders(parentId?: string | null): Promise<DmsFolder[]>;

    /** Full-text/metadata search. Returns [] when the connector is disabled. */
    search(query: string, opts?: DmsSearchOptions): Promise<DmsSearchResult[]>;

    /**
     * Fetch a document's bytes + metadata + version. Returns null when absent
     * or when the connector is disabled.
     */
    fetchDocument(docId: string): Promise<DmsDocument | null>;

    /**
     * Push content back to the DMS, optionally as a new version, and return the
     * resulting version id.
     */
    exportDocument(
        docId: string,
        content: ArrayBuffer,
        opts?: DmsExportOptions,
    ): Promise<DmsExportResult>;

    /**
     * Health-check the connector.
     * ok:true with latency when reachable, ok:false with error otherwise.
     */
    checkReady(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}
