// DMS connectors (R3 — iManage / NetDocuments). Thin {ok,...}|{ok:false,detail}
// wrappers over lib/dmsConnectors, mirroring the MCP wrappers. Air-gap gating +
// SSRF validation + project authz live in the service layer they call.
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract.

import {
    createDmsConnector as createDmsConnectorSvc,
    deleteDmsConnector as deleteDmsConnectorSvc,
    getDmsConnector as getDmsConnectorSvc,
    importDmsDocument as importDmsDocumentSvc,
    listDmsConnectors as listDmsConnectorsSvc,
    searchDms as searchDmsSvc,
    syncDmsConnector as syncDmsConnectorSvc,
    updateDmsConnector as updateDmsConnectorSvc,
    DmsOAuthRequiredError,
} from "../../lib/dmsConnectors";
import { type Db, type Log, errorMessage } from "./user.shared";

export async function listDmsConnectors(
    db: Db,
    userId: string,
    log: Log,
): Promise<{ ok: true; connectors: unknown } | { ok: false; detail: string }> {
    try {
        const connectors = await listDmsConnectorsSvc(userId, db);
        return { ok: true, connectors };
    } catch (err) {
        const detail = errorMessage(err);
        log.error({ userId, error: detail }, "[user/dms-connectors] list failed");
        return { ok: false, detail };
    }
}

export async function getDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await getDmsConnectorSvc(userId, connectorId, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] get failed",
        );
        return { ok: false, detail };
    }
}

export async function createDmsConnector(
    db: Db,
    userId: string,
    input: {
        kind: string;
        name: string;
        baseUrl: string;
        config?: Record<string, unknown>;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await createDmsConnectorSvc(userId, input, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error({ userId, error: detail }, "[user/dms-connectors] create failed");
        return { ok: false, detail };
    }
}

export async function updateDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    updates: {
        name?: string;
        baseUrl?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await updateDmsConnectorSvc(
            userId,
            connectorId,
            updates,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] update failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteDmsConnectorSvc(userId, connectorId, db);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function syncDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; result: unknown } | { ok: false; detail: string }> {
    try {
        const result = await syncDmsConnectorSvc(userId, connectorId, db);
        return { ok: true, result };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] sync failed",
        );
        if (err instanceof DmsOAuthRequiredError) {
            return { ok: false, detail: "oauth_required" };
        }
        return { ok: false, detail };
    }
}

export async function searchDmsConnector(
    db: Db,
    userId: string,
    connectorId: string,
    query: string,
    opts: { folderId?: string | null; limit?: number },
    log: Log,
): Promise<{ ok: true; results: unknown } | { ok: false; detail: string }> {
    try {
        const results = await searchDmsSvc(userId, connectorId, query, opts, db);
        return { ok: true, results };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, error: detail },
            "[user/dms-connectors] search failed",
        );
        return { ok: false, detail };
    }
}

export async function importDmsDocument(
    db: Db,
    userId: string,
    userEmail: string | null | undefined,
    connectorId: string,
    dmsDocId: string,
    projectId: string | null,
    log: Log,
): Promise<
    | { ok: true; documentId: string; doc: unknown }
    | { ok: false; status: number; detail: string }
> {
    try {
        const result = await importDmsDocumentSvc(
            userId,
            userEmail,
            connectorId,
            dmsDocId,
            projectId,
            db,
        );
        if (!result.ok) return result;
        return { ok: true, documentId: result.documentId, doc: result.doc };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            { userId, connectorId, dmsDocId, error: detail },
            "[user/dms-connectors] import failed",
        );
        const status = err instanceof DmsOAuthRequiredError ? 401 : 500;
        return { ok: false, status, detail };
    }
}
