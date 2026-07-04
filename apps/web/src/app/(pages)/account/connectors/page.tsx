"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import {
    type McpConnectorSummary,
    MikeApiError,
    createMcpConnector,
    deleteMcpConnector,
    getMcpConnector,
    isMfaRequiredError,
    listMcpConnectors,
    refreshMcpConnectorTools,
    setMcpToolEnabled,
    startMcpConnectorOAuth,
    updateMcpConnector,
} from "@/app/lib/mikeApi";
import { accountGlassPrimaryButtonClassName } from "../accountStyles";
import { AccountSection } from "../AccountSection";
import {
    type AddDraft,
    type AddStep,
    type DetailDraft,
    type McpOAuthPopupMessage,
    type PendingMfaAction,
    emptyAddDraft,
    isGoogleMcpConnector,
    mcpOAuthMessageOrigin,
    parseCustomHeaders,
} from "./connectorShared";
import { ConnectorsSkeleton, ConnectorRow } from "./ConnectorRow";
import { McpConnectorDetailsModal } from "./ConnectorModals";
import { NewMcpModal } from "@/app/components/account/NewMcpModal";

export default function ConnectorsPage() {
    const [connectors, setConnectors] = useState<McpConnectorSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingMfaAction, setPendingMfaAction] =
        useState<PendingMfaAction | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [addDraft, setAddDraft] = useState<AddDraft>(emptyAddDraft);
    const [addStep, setAddStep] = useState<AddStep>("form");
    const [addResult, setAddResult] = useState<McpConnectorSummary | null>(
        null,
    );
    const [addError, setAddError] = useState<string | null>(null);
    const [addAuthMessage, setAddAuthMessage] = useState<string | null>(null);
    const [showAddToken, setShowAddToken] = useState(false);
    const [showAddAdvanced, setShowAddAdvanced] = useState(false);
    const [selectedConnectorId, setSelectedConnectorId] = useState<
        string | null
    >(null);
    const [selectedConnectorDetails, setSelectedConnectorDetails] =
        useState<McpConnectorSummary | null>(null);
    const [detailDraft, setDetailDraft] = useState<DetailDraft>({
        ...emptyAddDraft,
        clearBearerToken: false,
    });
    const [detailError, setDetailError] = useState<string | null>(null);
    const [loadingConnectorId, setLoadingConnectorId] = useState<string | null>(
        null,
    );
    const [clearedBearerTokenConnectorId, setClearedBearerTokenConnectorId] =
        useState<string | null>(null);
    const [showDetailToken, setShowDetailToken] = useState(false);
    const [showDetailAdvanced, setShowDetailAdvanced] = useState(false);

    const selectedConnector = selectedConnectorDetails;

    const loadConnectors = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setConnectors(await listMcpConnectors());
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to load connectors.",
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadConnectors();
    }, [loadConnectors]);

    useEffect(() => {
        if (!selectedConnector) return;
        setDetailDraft({
            name: selectedConnector.name,
            serverUrl: selectedConnector.serverUrl,
            bearerToken: "",
            customHeaders: "",
            clearBearerToken: false,
        });
        setDetailError(null);
        setClearedBearerTokenConnectorId(null);
        setShowDetailToken(false);
        setShowDetailAdvanced(false);
    }, [
        selectedConnector?.id,
        selectedConnector?.name,
        selectedConnector?.serverUrl,
    ]);

    const replaceConnector = (
        connector: McpConnectorSummary,
        options: { preserveToolsOnEmpty?: boolean } = {},
    ) => {
        const mergeConnector = (current: McpConnectorSummary) => {
            if (
                options.preserveToolsOnEmpty &&
                connector.tools.length === 0 &&
                current.tools.length > 0
            ) {
                return { ...connector, tools: current.tools };
            }
            return connector;
        };
        setConnectors((prev) => {
            const exists = prev.some((item) => item.id === connector.id);
            if (!exists) return [connector, ...prev];
            return prev.map((item) =>
                item.id === connector.id ? mergeConnector(item) : item,
            );
        });
        setSelectedConnectorDetails((current) =>
            current?.id === connector.id ? mergeConnector(current) : current,
        );
    };

    const openConnectorDetails = async (connectorId: string) => {
        setSelectedConnectorId(connectorId);
        setSelectedConnectorDetails((current) =>
            current?.id === connectorId
                ? current
                : connectors.find((connector) => connector.id === connectorId) ??
                  null,
        );
        setDetailError(null);
        setLoadingConnectorId(connectorId);
        try {
            replaceConnector(await getMcpConnector(connectorId));
        } catch (err) {
            setDetailError(
                err instanceof Error
                    ? err.message
                    : "Failed to load connector details.",
            );
        } finally {
            setLoadingConnectorId((current) =>
                current === connectorId ? null : current,
            );
        }
    };

    const runSensitiveAction = async (
        action: PendingMfaAction,
        fn: () => Promise<void>,
    ) => {
        setError(null);
        setDetailError(null);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction(action);
                return;
            }
            await fn();
        } catch (err) {
            if (isMfaRequiredError(err)) {
                setPendingMfaAction(action);
                return;
            }
            const message =
                err instanceof Error ? err.message : "Action failed.";
            if (action.type === "create") setAddError(message);
            else if (action.type === "save") setDetailError(message);
            else setError(message);
        }
    };

    const closeAddModal = () => {
        if (addStep === "working" || addStep === "auth") return;
        setAddOpen(false);
        setAddDraft(emptyAddDraft);
        setAddStep("form");
        setAddResult(null);
        setAddError(null);
        setAddAuthMessage(null);
        setShowAddToken(false);
        setShowAddAdvanced(false);
    };

    const connectConnectorOAuth = async (
        connectorId: string,
    ): Promise<McpConnectorSummary | null> => {
        const popup = window.open(
            "about:blank",
            "mike_mcp_oauth",
            "popup,width=560,height=720,menubar=no,toolbar=no,location=no,status=no",
        );
        const { authorizationUrl, alreadyAuthorized } =
            await startMcpConnectorOAuth(connectorId);
        if (alreadyAuthorized) {
            popup?.close();
            const refreshed = await refreshMcpConnectorTools(connectorId);
            replaceConnector(refreshed);
            return refreshed;
        }
        if (!authorizationUrl) {
            popup?.close();
            throw new Error("OAuth authorization URL was not returned.");
        }
        if (!popup) {
            window.location.assign(authorizationUrl);
            return null;
        }
        popup.location.href = authorizationUrl;

        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error("OAuth authorization timed out."));
            }, 5 * 60 * 1000);
            const poll = window.setInterval(() => {
                if (popup.closed) {
                    cleanup();
                    reject(new Error("OAuth authorization window was closed."));
                }
            }, 700);
            const cleanup = () => {
                window.clearTimeout(timeout);
                window.clearInterval(poll);
                window.removeEventListener("message", onMessage);
            };
            const onMessage = (event: MessageEvent<McpOAuthPopupMessage>) => {
                if (event.origin !== mcpOAuthMessageOrigin) return;
                if (event.data?.type !== "mcp_oauth_result") return;
                if (
                    event.data.connectorId &&
                    event.data.connectorId !== connectorId
                ) {
                    return;
                }
                const sourceWindow = event.source as Window | null;
                sourceWindow?.postMessage(
                    { type: "mcp_oauth_result_ack" },
                    event.origin,
                );
                cleanup();
                if (event.data.success) {
                    resolve();
                    return;
                }
                reject(
                    new Error(
                        event.data.detail || "OAuth authorization failed.",
                    ),
                );
            };
            window.addEventListener("message", onMessage);
        });

        const refreshed = await refreshMcpConnectorTools(connectorId);
        replaceConnector(refreshed);
        return refreshed;
    };

    const handleCreate = async () => {
        await runSensitiveAction({ type: "create" }, async () => {
            setBusyKey("create");
            setAddStep("working");
            setAddError(null);
            setAddAuthMessage(null);
            try {
                const headers = parseCustomHeaders(addDraft.customHeaders);
                const connector = await createMcpConnector({
                    name: addDraft.name,
                    serverUrl: addDraft.serverUrl,
                    bearerToken: addDraft.bearerToken.trim() || null,
                    ...(headers ? { headers } : {}),
                });
                let refreshed: McpConnectorSummary;
                try {
                    refreshed = await refreshMcpConnectorTools(connector.id);
                } catch (err) {
                    if (
                        err instanceof MikeApiError &&
                        err.code === "oauth_required"
                    ) {
                        replaceConnector(connector);
                        setAddAuthMessage(
                            "Complete authorization in the popup to finish connecting this MCP server.",
                        );
                        setAddStep("auth");
                        const authorized = await connectConnectorOAuth(
                            connector.id,
                        );
                        if (authorized) {
                            setAddAuthMessage(null);
                            setAddResult(authorized);
                            setAddStep("success");
                        }
                        return;
                    }
                    throw err;
                }
                replaceConnector(refreshed);
                if (isGoogleMcpConnector(refreshed) && !refreshed.oauthConnected) {
                    setAddAuthMessage(
                        "Authorize Google in the popup to finish connecting this MCP server.",
                    );
                    setAddStep("auth");
                    const authorized = await connectConnectorOAuth(refreshed.id);
                    if (authorized) {
                        setAddAuthMessage(null);
                        setAddResult(authorized);
                        setAddStep("success");
                    }
                    return;
                }
                setAddResult(refreshed);
                setAddStep("success");
            } catch (err) {
                setAddStep("form");
                setAddAuthMessage(null);
                setAddError(
                    err instanceof Error
                        ? err.message
                        : "Failed to add connector.",
                );
            } finally {
                setBusyKey(null);
            }
        });
    };

    const handleSaveSelectedConnector = async () => {
        if (!selectedConnector) return;
        await runSensitiveAction(
            { type: "save", connectorId: selectedConnector.id },
            async () => {
                setBusyKey(`save:${selectedConnector.id}`);
                setDetailError(null);
                try {
                    const headers = parseCustomHeaders(
                        detailDraft.customHeaders,
                    );
                    const saved = await updateMcpConnector(selectedConnector.id, {
                        name: detailDraft.name,
                        serverUrl: detailDraft.serverUrl,
                        ...(detailDraft.bearerToken.trim()
                            ? { bearerToken: detailDraft.bearerToken.trim() }
                            : {}),
                        ...(headers ? { headers } : {}),
                    });
                    const shouldRefreshTools =
                        saved.serverUrl !== selectedConnector.serverUrl ||
                        !!detailDraft.bearerToken.trim() ||
                        !!headers;
                    const refreshed = shouldRefreshTools
                            ? await refreshMcpConnectorTools(saved.id)
                            : saved;
                    replaceConnector(refreshed, {
                        preserveToolsOnEmpty: !shouldRefreshTools,
                    });
                    setDetailDraft({
                        name: refreshed.name,
                        serverUrl: refreshed.serverUrl,
                        bearerToken: "",
                        customHeaders: "",
                        clearBearerToken: false,
                    });
                } finally {
                    setBusyKey(null);
                }
            },
        );
    };

    const handleClearBearerToken = async (connectorId: string) => {
        await runSensitiveAction(
            { type: "clear-token", connectorId },
            async () => {
                setBusyKey(`clear-token:${connectorId}`);
                setDetailError(null);
                setClearedBearerTokenConnectorId(null);
                try {
                    const saved = await updateMcpConnector(connectorId, {
                        bearerToken: null,
                    });
                    replaceConnector(saved, { preserveToolsOnEmpty: true });
                    setDetailDraft((prev) => ({
                        ...prev,
                        bearerToken: "",
                        clearBearerToken: false,
                    }));
                    setClearedBearerTokenConnectorId(connectorId);
                } finally {
                    setBusyKey(null);
                }
            },
        );
    };

    const handleRefresh = async (connectorId: string) => {
        await runSensitiveAction({ type: "refresh", connectorId }, async () => {
            setBusyKey(`refresh:${connectorId}`);
            try {
                try {
                    replaceConnector(await refreshMcpConnectorTools(connectorId));
                } catch (err) {
                    if (
                        err instanceof MikeApiError &&
                            err.code === "oauth_required"
                    ) {
                        await connectConnectorOAuth(connectorId);
                        return;
                    }
                    throw err;
                }
            } finally {
                setBusyKey(null);
            }
        });
    };

    const handleConnectorEnabled = async (
        connectorId: string,
        enabled: boolean,
    ) => {
        await runSensitiveAction(
            { type: "connector-enabled", connectorId, enabled },
            async () => {
                setBusyKey(`connector:${connectorId}`);
                try {
                    replaceConnector(
                        await updateMcpConnector(connectorId, { enabled }),
                        { preserveToolsOnEmpty: true },
                    );
                } finally {
                    setBusyKey(null);
                }
            },
        );
    };

    const handleToolEnabled = async (
        connectorId: string,
        toolId: string,
        enabled: boolean,
    ) => {
        await runSensitiveAction(
            { type: "tool-enabled", connectorId, toolId, enabled },
            async () => {
                setBusyKey(`tool:${toolId}`);
                try {
                    replaceConnector(
                        await setMcpToolEnabled(connectorId, toolId, enabled),
                    );
                } finally {
                    setBusyKey(null);
                }
            },
        );
    };

    const handleDelete = async (connectorId: string) => {
        await runSensitiveAction({ type: "delete", connectorId }, async () => {
            setBusyKey(`delete:${connectorId}`);
            try {
                await deleteMcpConnector(connectorId);
                setConnectors((prev) =>
                    prev.filter((item) => item.id !== connectorId),
                );
                if (selectedConnectorId === connectorId) {
                    setSelectedConnectorId(null);
                    setSelectedConnectorDetails(null);
                }
            } finally {
                setBusyKey(null);
            }
        });
    };

    const handleMfaVerified = async () => {
        const action = pendingMfaAction;
        setPendingMfaAction(null);
        if (!action) return;
        if (action.type === "create") await handleCreate();
        if (action.type === "save") await handleSaveSelectedConnector();
        if (action.type === "clear-token") {
            await handleClearBearerToken(action.connectorId);
        }
        if (action.type === "refresh") await handleRefresh(action.connectorId);
        if (action.type === "delete") await handleDelete(action.connectorId);
        if (action.type === "connector-enabled") {
            await handleConnectorEnabled(action.connectorId, action.enabled);
        }
        if (action.type === "tool-enabled") {
            await handleToolEnabled(
                action.connectorId,
                action.toolId,
                action.enabled,
            );
        }
    };

    return (
        <div>
            <div className="mb-4">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="font-serif text-2xl font-medium text-gray-900">
                        Connectors
                    </h2>
                    <button
                        type="button"
                        onClick={() => setAddOpen(true)}
                        className={`inline-flex h-9 items-center gap-1.5 text-sm ${accountGlassPrimaryButtonClassName}`}
                    >
                        <Plus className="h-4 w-4" />
                        Add
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="space-y-3">
                {loading ? (
                    <ConnectorsSkeleton />
                ) : connectors.length === 0 ? (
                    <AccountSection className="p-4">
                        <p className="text-sm text-gray-500">
                            No connectors yet.
                        </p>
                    </AccountSection>
                ) : (
                    connectors.map((connector) => (
                        <ConnectorRow
                            key={connector.id}
                            connector={connector}
                            busyKey={busyKey}
                            onOpen={() => void openConnectorDetails(connector.id)}
                            onConnectorEnabled={handleConnectorEnabled}
                        />
                    ))
                )}
            </div>

            <NewMcpModal
                open={addOpen}
                draft={addDraft}
                step={addStep}
                result={addResult}
                error={addError}
                authMessage={addAuthMessage}
                showToken={showAddToken}
                showAdvanced={showAddAdvanced}
                onDraftChange={setAddDraft}
                onShowTokenChange={setShowAddToken}
                onShowAdvancedChange={setShowAddAdvanced}
                onClose={closeAddModal}
                onSubmit={handleCreate}
                onOpenConnector={(connectorId) => {
                    void openConnectorDetails(connectorId);
                    closeAddModal();
                }}
            />

            <McpConnectorDetailsModal
                connector={selectedConnector}
                draft={detailDraft}
                error={detailError}
                busyKey={busyKey}
                toolsLoading={loadingConnectorId === selectedConnectorId}
                clearTokenStatus={
                    selectedConnectorId &&
                    busyKey === `clear-token:${selectedConnectorId}`
                        ? "clearing"
                        : selectedConnectorId === clearedBearerTokenConnectorId
                          ? "cleared"
                          : "idle"
                }
                showToken={showDetailToken}
                showAdvanced={showDetailAdvanced}
                onDraftChange={setDetailDraft}
                onShowTokenChange={setShowDetailToken}
                onShowAdvancedChange={setShowDetailAdvanced}
                onClose={() => {
                    setSelectedConnectorId(null);
                    setSelectedConnectorDetails(null);
                }}
                onSave={handleSaveSelectedConnector}
                onClearBearerToken={handleClearBearerToken}
                onRefresh={handleRefresh}
                onDelete={handleDelete}
                onConnectorEnabled={handleConnectorEnabled}
                onToolEnabled={handleToolEnabled}
            />

            <MfaVerificationPopup
                open={!!pendingMfaAction}
                onCancel={() => setPendingMfaAction(null)}
                onVerified={() => void handleMfaVerified()}
            />
        </div>
    );
}
