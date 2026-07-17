import { Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { type McpConnectorSummary } from "@/app/lib/mikeApi";
import { AccountToggle } from "../AccountToggle";
import type { DetailDraft } from "./connectorShared";
import {
    ConnectorForm,
    ScrollableToolList,
    ToolListSkeleton,
} from "./ConnectorForm";

// The connector details dialog: edit an existing MCP connector's fields and
// manage its tools. (Adding a new connector lives in
// `@/app/components/account/NewMcpModal`.)

export function McpConnectorDetailsModal({
    connector,
    draft,
    error,
    busyKey,
    toolsLoading,
    clearTokenStatus,
    showToken,
    showAdvanced,
    onDraftChange,
    onShowTokenChange,
    onShowAdvancedChange,
    onClose,
    onSave,
    onClearBearerToken,
    onRefresh,
    onDelete,
    onConnectorEnabled,
    onToolEnabled,
}: {
    connector: McpConnectorSummary | null;
    draft: DetailDraft;
    error: string | null;
    busyKey: string | null;
    toolsLoading: boolean;
    clearTokenStatus: "idle" | "clearing" | "cleared";
    showToken: boolean;
    showAdvanced: boolean;
    onDraftChange: (draft: DetailDraft) => void;
    onShowTokenChange: (show: boolean) => void;
    onShowAdvancedChange: (show: boolean) => void;
    onClose: () => void;
    onSave: () => Promise<void>;
    onClearBearerToken: (connectorId: string) => Promise<void>;
    onRefresh: (connectorId: string) => Promise<void>;
    onDelete: (connectorId: string) => Promise<void>;
    onConnectorEnabled: (
        connectorId: string,
        enabled: boolean,
    ) => Promise<void>;
    onToolEnabled: (
        connectorId: string,
        toolId: string,
        enabled: boolean,
    ) => Promise<void>;
}) {
    const hasChanges =
        !!connector &&
        (draft.name.trim() !== connector.name ||
            draft.serverUrl.trim() !== connector.serverUrl ||
            draft.bearerToken.trim().length > 0 ||
            draft.customHeaders.trim().length > 0);
    const isSaving = !!connector && busyKey === `save:${connector.id}`;

    return (
        <Modal
            open={!!connector}
            onClose={onClose}
            breadcrumbs={["Connectors", connector?.name ?? "MCP connector"]}
            headerAction={
                connector ? (
                    <AccountToggle
                        checked={connector.enabled}
                        disabled={busyKey === `connector:${connector.id}`}
                        loading={busyKey === `connector:${connector.id}`}
                        label={connector.enabled ? "Enabled" : "Disabled"}
                        onChange={(enabled) =>
                            void onConnectorEnabled(connector.id, enabled)
                        }
                    />
                ) : null
            }
            size="md"
            secondaryAction={
                connector
                    ? {
                          label: "Delete connector",
                          variant: "danger",
                          onClick: () => void onDelete(connector.id),
                          disabled: busyKey === `delete:${connector.id}`,
                      }
                    : undefined
            }
            primaryAction={{
                label: isSaving ? "Saving..." : "Save",
                icon: isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : undefined,
                onClick: () => void onSave(),
                disabled:
                    !connector ||
                    !hasChanges ||
                    isSaving ||
                    !draft.name.trim() ||
                    !draft.serverUrl.trim(),
            }}
            cancelAction={{ label: "Close", onClick: onClose }}
            footerStatus={
                error ? (
                    <span className="text-sm text-red-600">{error}</span>
                ) : null
            }
        >
            {connector && (
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4">
                    <ConnectorForm
                        draft={draft}
                        showToken={showToken}
                        showAdvanced={showAdvanced}
                        tokenPlaceholder={
                            connector.hasAuthConfig
                                ? "Saved token encrypted"
                                : "Bearer token"
                        }
                        tokenAction={
                            connector.hasAuthConfig ||
                            clearTokenStatus === "cleared"
                                ? {
                                      label:
                                          clearTokenStatus === "cleared"
                                              ? "Cleared"
                                              : "Clear",
                                      loading:
                                          clearTokenStatus === "clearing",
                                      cleared:
                                          clearTokenStatus === "cleared",
                                      onClick: () =>
                                          void onClearBearerToken(connector.id),
                                  }
                                : undefined
                        }
                        onDraftChange={(next) =>
                            onDraftChange({
                                ...draft,
                                name: next.name,
                                serverUrl: next.serverUrl,
                                bearerToken: next.bearerToken,
                                customHeaders: next.customHeaders,
                            })
                        }
                        onShowTokenChange={onShowTokenChange}
                        onShowAdvancedChange={onShowAdvancedChange}
                    />
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-xs font-medium text-gray-500">
                                {toolsLoading
                                    ? connector.toolCount
                                    : connector.tools.length}{" "}
                                {(toolsLoading
                                    ? connector.toolCount
                                    : connector.tools.length) === 1
                                    ? "Tool"
                                    : "Tools"}
                            </h3>
                            <div className="flex items-center">
                                <button
                                    type="button"
                                    onClick={() => void onRefresh(connector.id)}
                                    disabled={
                                        busyKey === `refresh:${connector.id}`
                                    }
                                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
                                >
                                    {busyKey === `refresh:${connector.id}` ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    )}
                                    Refresh
                                </button>
                            </div>
                        </div>
                        {toolsLoading ? (
                            <ToolListSkeleton count={connector.toolCount} fill />
                        ) : (
                            <ScrollableToolList
                                connector={connector}
                                busyKey={busyKey}
                                onToolEnabled={onToolEnabled}
                                fill
                            />
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}
