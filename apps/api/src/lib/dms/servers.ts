/**
 * DMS connector orchestration: CRUD, adapter resolution, and the
 * folders/search/import/export operations, with air-gap gating and project
 * authorization. Mirrors lib/mcp/servers.ts.
 *
 * AIR-GAP: iManage and NetDocuments are cloud SaaS with no local fallback
 * (unlike the Ollama LLM fallback), so when AIRGAPPED=true every operation on a
 * cloud connector — create, authenticate/sync, import, export, folders, search
 * — is refused. The in-memory FakeDMSAdapter has no egress and stays fully
 * usable air-gapped (it is the connector kind tests rely on).
 */
import { isAirgapped } from "../airgap";
import { checkProjectAccess } from "../access";
import { validateRemoteMcpUrl } from "../mcp/client";
import { createServerSupabase } from "../supabase";
import { downloadFile } from "../storage";
import { loadActiveVersion } from "../documentVersions";
import {
    getDmsAdapter,
    isCloudDmsKind,
    type DmsAdapterConfig,
    type DmsConnector,
    type DmsExportResult,
    type DmsFolder,
    type DmsSearchOptions,
    type DmsSearchResult,
    type DmsKind,
} from "./index";
import {
    getValidDmsAccessToken,
    loadDmsConnector,
    loadDmsOAuthToken,
} from "./oauth";
import { importDmsDocumentToProject, loadDmsDocumentLink } from "./import";
import type { Db, DmsConnectorRow, DmsConnectorSummary } from "./types";

const VALID_KINDS: DmsKind[] = ["fake", "imanage", "netdocuments"];

function airgapGuard(kind: DmsKind): void {
    if (isCloudDmsKind(kind) && isAirgapped()) {
        throw new Error(
            `The ${kind} DMS connector reaches an external cloud service and is disabled in air-gapped mode.`,
        );
    }
}

function toSummary(
    row: DmsConnectorRow,
    oauthConnected: boolean,
): DmsConnectorSummary {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        baseUrl: row.base_url,
        authType: row.auth_type,
        enabled: row.enabled,
        oauthConnected,
        config: row.config ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Build a live adapter for a connector row. Cloud kinds get a getAccessToken
 * hook that returns a freshly-refreshed OAuth bearer token per request; the
 * fake kind ignores config. Refuses cloud kinds when air-gapped.
 */
export function resolveDmsAdapter(
    row: DmsConnectorRow,
    db: Db = createServerSupabase(),
): DmsConnector {
    airgapGuard(row.kind);
    const config = row.config ?? {};
    const adapterConfig: DmsAdapterConfig = {
        baseUrl: row.base_url,
        getAccessToken: () => getValidDmsAccessToken(row.id, db),
        customerId:
            typeof config.customer_id === "string" ? config.customer_id : null,
        library: typeof config.library === "string" ? config.library : null,
        repository:
            typeof config.repository === "string" ? config.repository : null,
    };
    return getDmsAdapter(row.kind, adapterConfig);
}

export async function listDmsConnectors(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<DmsConnectorSummary[]> {
    const { data, error } = await db
        .from("dms_connectors")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as DmsConnectorRow[];
    if (!rows.length) return [];
    const { data: tokenRows, error: tokenError } = await db
        .from("dms_connector_oauth_tokens")
        .select("connector_id, encrypted_access_token")
        .in(
            "connector_id",
            rows.map((r) => r.id),
        );
    if (tokenError) throw tokenError;
    const connected = new Set(
        ((tokenRows ?? []) as Array<{
            connector_id: string;
            encrypted_access_token: string | null;
        }>)
            .filter((t) => !!t.encrypted_access_token)
            .map((t) => t.connector_id),
    );
    return rows.map((row) => toSummary(row, connected.has(row.id)));
}

export async function getDmsConnector(
    userId: string,
    connectorId: string,
    db: Db = createServerSupabase(),
): Promise<DmsConnectorSummary> {
    const row = await loadDmsConnector(userId, connectorId, db);
    const token = await loadDmsOAuthToken(connectorId, db);
    return toSummary(row, !!token?.encrypted_access_token);
}

export async function createDmsConnector(
    userId: string,
    input: {
        kind: string;
        name: string;
        baseUrl: string;
        config?: Record<string, unknown>;
    },
    db: Db = createServerSupabase(),
): Promise<DmsConnectorSummary> {
    const kind = input.kind as DmsKind;
    if (!VALID_KINDS.includes(kind)) {
        throw new Error(`Unknown DMS connector kind "${input.kind}".`);
    }
    airgapGuard(kind);
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Connector name is required.");

    // SSRF: validate the tenant base URL exactly like createUserMcpConnector
    // validates serverUrl (HTTPS-only, private-IP guard). The Fake backend is
    // in-memory with no egress, so its base URL is not network-validated.
    let baseUrl = input.baseUrl.trim();
    if (isCloudDmsKind(kind)) {
        baseUrl = await validateRemoteMcpUrl(baseUrl);
    }

    const { data, error } = await db
        .from("dms_connectors")
        .insert({
            user_id: userId,
            kind,
            name,
            base_url: baseUrl,
            auth_type: "oauth",
            enabled: true,
            config: input.config ?? {},
        })
        .select("*")
        .single();
    if (error) throw error;
    return toSummary(data as DmsConnectorRow, false);
}

export async function updateDmsConnector(
    userId: string,
    connectorId: string,
    input: {
        name?: string;
        baseUrl?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    },
    db: Db = createServerSupabase(),
): Promise<DmsConnectorSummary> {
    const current = await loadDmsConnector(userId, connectorId, db);
    const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };
    if (typeof input.name === "string") {
        const name = input.name.trim().slice(0, 80);
        if (!name) throw new Error("Connector name is required.");
        update.name = name;
    }
    if (typeof input.baseUrl === "string") {
        const trimmed = input.baseUrl.trim();
        update.base_url = isCloudDmsKind(current.kind)
            ? await validateRemoteMcpUrl(trimmed)
            : trimmed;
    }
    if (typeof input.enabled === "boolean") update.enabled = input.enabled;
    if (input.config && typeof input.config === "object") {
        update.config = { ...(current.config ?? {}), ...input.config };
    }
    const { data, error } = await db
        .from("dms_connectors")
        .update(update)
        .eq("user_id", userId)
        .eq("id", connectorId)
        .select("*")
        .single();
    if (error) throw error;
    const token = await loadDmsOAuthToken(connectorId, db);
    return toSummary(data as DmsConnectorRow, !!token?.encrypted_access_token);
}

export async function deleteDmsConnector(
    userId: string,
    connectorId: string,
    db: Db = createServerSupabase(),
): Promise<void> {
    const { error } = await db
        .from("dms_connectors")
        .delete()
        .eq("user_id", userId)
        .eq("id", connectorId);
    if (error) throw error;
}

/** Authenticate/sync a connector (verifies credentials reach the DMS). */
export async function syncDmsConnector(
    userId: string,
    connectorId: string,
    db: Db = createServerSupabase(),
): Promise<{ ok: boolean; error?: string }> {
    const row = await loadDmsConnector(userId, connectorId, db);
    const adapter = resolveDmsAdapter(row, db);
    return adapter.authenticate();
}

export async function listDmsFolders(
    userId: string,
    connectorId: string,
    parentId: string | null,
    db: Db = createServerSupabase(),
): Promise<DmsFolder[]> {
    const row = await loadDmsConnector(userId, connectorId, db);
    return resolveDmsAdapter(row, db).listFolders(parentId);
}

export async function searchDms(
    userId: string,
    connectorId: string,
    query: string,
    opts: DmsSearchOptions,
    db: Db = createServerSupabase(),
): Promise<DmsSearchResult[]> {
    const row = await loadDmsConnector(userId, connectorId, db);
    return resolveDmsAdapter(row, db).search(query, opts);
}

/**
 * Fetch a DMS document and import it into a project the user can access.
 * Enforces project authorization via checkProjectAccess before any write.
 */
export async function importDmsDocument(
    userId: string,
    userEmail: string | null | undefined,
    connectorId: string,
    dmsDocId: string,
    projectId: string | null,
    db: Db = createServerSupabase(),
): Promise<
    | { ok: true; documentId: string; doc: unknown }
    | { ok: false; status: number; detail: string }
> {
    if (projectId) {
        const access = await checkProjectAccess(projectId, userId, userEmail, db);
        if (!access.ok) {
            return {
                ok: false,
                status: 404,
                detail: "Project not found or access denied.",
            };
        }
    }
    const row = await loadDmsConnector(userId, connectorId, db);
    const adapter = resolveDmsAdapter(row, db);
    const document = await adapter.fetchDocument(dmsDocId);
    if (!document) {
        return {
            ok: false,
            status: 404,
            detail: "Document not found in the DMS.",
        };
    }
    const imported = await importDmsDocumentToProject(
        { userId, projectId, connectorId, dmsDocId, document },
        db,
    );
    if (!imported.ok) {
        return { ok: false, status: 400, detail: imported.detail };
    }
    return {
        ok: true,
        documentId: imported.result.documentId,
        doc: imported.result.doc,
    };
}

/**
 * Export a Mike document's active version back to the DMS, as a new version by
 * default. Requires the document to have been imported from this connector
 * (a dms_document_links row) so the export targets the right external doc.
 */
export async function exportDocumentToDms(
    userId: string,
    userEmail: string | null | undefined,
    documentId: string,
    db: Db = createServerSupabase(),
): Promise<
    | { ok: true; result: DmsExportResult }
    | { ok: false; status: number; detail: string }
> {
    const link = await loadDmsDocumentLink(documentId, db);
    if (!link) {
        return {
            ok: false,
            status: 404,
            detail: "This document was not imported from a DMS connector.",
        };
    }
    // Authorize against the document's project (owner check inside the loader).
    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, project_id, org_id, current_version_id")
        .eq("id", documentId)
        .single();
    if (!doc) {
        return { ok: false, status: 404, detail: "Document not found." };
    }
    const typedDoc = doc as {
        user_id: string;
        project_id: string | null;
    };
    if (typedDoc.user_id !== userId && typedDoc.project_id) {
        const access = await checkProjectAccess(
            typedDoc.project_id,
            userId,
            userEmail,
            db,
        );
        if (!access.ok) {
            return { ok: false, status: 404, detail: "Access denied." };
        }
    } else if (typedDoc.user_id !== userId) {
        return { ok: false, status: 404, detail: "Access denied." };
    }

    const version = await loadActiveVersion(documentId, db);
    if (!version?.storage_path) {
        return {
            ok: false,
            status: 400,
            detail: "Document has no stored content to export.",
        };
    }
    const bytes = await downloadFile(version.storage_path);
    if (!bytes) {
        return {
            ok: false,
            status: 400,
            detail: "Document content could not be read from storage.",
        };
    }

    const row = await loadDmsConnector(userId, link.connector_id, db);
    const adapter = resolveDmsAdapter(row, db);
    const result = await adapter.exportDocument(link.dms_doc_id, bytes, {
        newVersion: true,
        filename: version.filename ?? undefined,
    });
    // Advance the recorded external version so a subsequent export/import stays
    // consistent with the DMS.
    await db
        .from("dms_document_links")
        .update({ dms_version: result.version })
        .eq("document_id", documentId);
    return { ok: true, result };
}

export type { DmsConnectorSummary };
