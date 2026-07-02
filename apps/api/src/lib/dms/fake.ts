/**
 * In-memory DMS connector. Deterministic, dependency-free, and usable
 * air-gapped (no network egress ever), so it is the default adapter and the
 * backbone of the DMS test suite.
 *
 * It stores folders and documents (with a per-document version list) in plain
 * Maps. Seeding is explicit via seed()/reset() so tests are hermetic.
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

interface FakeVersion {
    version: string;
    content: ArrayBuffer;
}

interface FakeDoc {
    id: string;
    name: string;
    folderId: string | null;
    contentType: string;
    extension: string;
    author: string | null;
    updatedAt: string;
    versions: FakeVersion[];
}

const textEncoder = new TextEncoder();

function toArrayBuffer(text: string): ArrayBuffer {
    const view = textEncoder.encode(text);
    return view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength,
    ) as ArrayBuffer;
}

export class FakeDMSAdapter implements DmsConnector {
    public readonly kind: DmsKind = "fake";
    // The Fake is always ready — it needs no credentials and no network.
    public readonly enabled = true;

    private readonly folders = new Map<string, DmsFolder>();
    private readonly docs = new Map<string, FakeDoc>();

    constructor(_config?: DmsAdapterConfig) {
        void _config;
    }

    /** Wipe all in-memory state (call in test setup). */
    reset(): void {
        this.folders.clear();
        this.docs.clear();
    }

    /** Seed a folder. Chainable for terse test fixtures. */
    seedFolder(folder: DmsFolder): this {
        this.folders.set(folder.id, { ...folder });
        return this;
    }

    /**
     * Seed a document with V1 content. Returns the seeded id. Content may be a
     * string (encoded UTF-8) or raw bytes.
     */
    seedDocument(doc: {
        id: string;
        name: string;
        folderId?: string | null;
        contentType?: string;
        extension?: string;
        author?: string | null;
        content: string | ArrayBuffer;
    }): string {
        const content =
            typeof doc.content === "string"
                ? toArrayBuffer(doc.content)
                : doc.content;
        this.docs.set(doc.id, {
            id: doc.id,
            name: doc.name,
            folderId: doc.folderId ?? null,
            contentType: doc.contentType ?? "application/pdf",
            extension: doc.extension ?? "pdf",
            author: doc.author ?? null,
            updatedAt: "2026-01-01T00:00:00.000Z",
            versions: [{ version: "1", content }],
        });
        return doc.id;
    }

    async authenticate(): Promise<DmsAuthResult> {
        return { ok: true };
    }

    async listFolders(parentId?: string | null): Promise<DmsFolder[]> {
        const target = parentId ?? null;
        return [...this.folders.values()]
            .filter((f) => f.parentId === target)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    async search(
        query: string,
        opts: DmsSearchOptions = {},
    ): Promise<DmsSearchResult[]> {
        const needle = query.trim().toLowerCase();
        const limit = opts.limit ?? 50;
        return [...this.docs.values()]
            .filter((d) => {
                if (opts.folderId && d.folderId !== opts.folderId) return false;
                if (!needle) return true;
                return d.name.toLowerCase().includes(needle);
            })
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, limit)
            .map((d) => ({
                id: d.id,
                name: d.name,
                folderId: d.folderId,
                contentType: d.contentType,
                version: d.versions[d.versions.length - 1]?.version ?? null,
            }));
    }

    async fetchDocument(docId: string): Promise<DmsDocument | null> {
        const doc = this.docs.get(docId);
        if (!doc) return null;
        const latest = doc.versions[doc.versions.length - 1];
        return {
            content: latest.content,
            version: latest.version,
            metadata: {
                id: doc.id,
                name: doc.name,
                contentType: doc.contentType,
                extension: doc.extension,
                sizeBytes: latest.content.byteLength,
                folderId: doc.folderId,
                author: doc.author,
                updatedAt: doc.updatedAt,
            },
        };
    }

    async exportDocument(
        docId: string,
        content: ArrayBuffer,
        opts: DmsExportOptions = {},
    ): Promise<DmsExportResult> {
        const doc = this.docs.get(docId);
        if (!doc) {
            throw new Error(`FakeDMSAdapter: unknown document ${docId}`);
        }
        if (opts.newVersion === false) {
            // Overwrite the current version in place.
            const current = doc.versions[doc.versions.length - 1];
            current.content = content;
            return { docId, version: current.version };
        }
        const nextVersion = String(doc.versions.length + 1);
        doc.versions.push({ version: nextVersion, content });
        doc.updatedAt = new Date().toISOString();
        return { docId, version: nextVersion };
    }

    async checkReady(): Promise<{
        ok: boolean;
        latencyMs?: number;
        error?: string;
    }> {
        return { ok: true, latencyMs: 0 };
    }
}

/**
 * A process-wide shared Fake instance. The registry's default `fake` factory
 * returns this singleton so a connector row of kind `fake` and any direct
 * caller observe the same seeded state (mirrors how a real DMS is one backing
 * store). Tests seed/reset it explicitly.
 */
export const sharedFakeDms = new FakeDMSAdapter();
