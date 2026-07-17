// MCP connectors: thin {ok,...}|{ok:false,detail} wrappers over
// lib/mcpConnectors.
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract.

import { logger } from "../../lib/logger";
import {
    createUserMcpConnector,
    deleteUserMcpConnector,
    getUserMcpConnector,
    listUserMcpConnectors,
    McpOAuthRequiredError,
    refreshUserMcpConnectorTools,
    setUserMcpToolEnabled,
    startUserMcpConnectorOAuth,
    updateUserMcpConnector,
} from "../../lib/mcpConnectors";
import { type Db, type Log, errorMessage } from "./user.shared";

export async function listMcpConnectors(
    db: Db,
    userId: string,
): Promise<{ ok: true; connectors: unknown } | { ok: false; detail: string }> {
    try {
        const connectors = await listUserMcpConnectors(userId, db, {
            includeTools: false,
        });
        return { ok: true, connectors };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/mcp-connectors] list failed",
        );
        return { ok: false, detail };
    }
}

export async function getMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await getUserMcpConnector(userId, connectorId, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] get failed",
        );
        return { ok: false, detail };
    }
}

export async function createMcpConnector(
    db: Db,
    userId: string,
    params: {
        name: string;
        serverUrl: string;
        bearerToken: string | null;
        headers: Record<string, unknown> | undefined;
    },
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await createUserMcpConnector(userId, params, db);
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                error: detail,
            },
            "[user/mcp-connectors] create failed",
        );
        return { ok: false, detail };
    }
}

export async function updateMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    updates: Parameters<typeof updateUserMcpConnector>[2],
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await updateUserMcpConnector(
            userId,
            connectorId,
            updates,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] update failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteMcpConnector(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserMcpConnector(userId, connectorId, db);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function startMcpConnectorOAuth(
    db: Db,
    userId: string,
    connectorId: string,
    redirectUri: string,
    log: Log,
): Promise<{ ok: true; result: unknown } | { ok: false; detail: string }> {
    try {
        const result = await startUserMcpConnectorOAuth(
            userId,
            connectorId,
            redirectUri,
            db,
        );
        return { ok: true, result };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] oauth start failed",
        );
        return { ok: false, detail };
    }
}

export type RefreshMcpToolsResult =
    | { ok: true; connector: unknown }
    | { ok: false; kind: "oauth_required"; code: string; detail: string }
    | { ok: false; kind: "error"; detail: string };

export async function refreshMcpConnectorTools(
    db: Db,
    userId: string,
    connectorId: string,
    log: Log,
): Promise<RefreshMcpToolsResult> {
    try {
        const connector = await refreshUserMcpConnectorTools(
            userId,
            connectorId,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                error: detail,
            },
            "[user/mcp-connectors] refresh failed",
        );
        if (err instanceof McpOAuthRequiredError) {
            return { ok: false, kind: "oauth_required", code: err.code, detail };
        }
        return { ok: false, kind: "error", detail };
    }
}

export async function setMcpToolEnabled(
    db: Db,
    userId: string,
    connectorId: string,
    toolId: string,
    enabled: boolean,
    log: Log,
): Promise<{ ok: true; connector: unknown } | { ok: false; detail: string }> {
    try {
        const connector = await setUserMcpToolEnabled(
            userId,
            connectorId,
            toolId,
            enabled,
            db,
        );
        return { ok: true, connector };
    } catch (err) {
        const detail = errorMessage(err);
        log.error(
            {
                userId,
                connectorId,
                toolId,
                error: detail,
            },
            "[user/mcp-connectors] tool toggle failed",
        );
        return { ok: false, detail };
    }
}
