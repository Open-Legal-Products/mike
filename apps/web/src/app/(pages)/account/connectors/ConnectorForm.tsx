import { useState } from "react";
import { ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { type McpConnectorSummary } from "@/app/lib/mikeApi";
import {
    accountGlassIconButtonClassName,
    accountGlassInputClassName,
} from "../accountStyles";
import { AccountToggle } from "../AccountToggle";
import type { AddDraft } from "./connectorShared";

// Presentational building blocks for the connector details modal: the
// connector form and the discovered-tools list (+ its skeleton).

export function ConnectorForm({
    draft,
    showToken,
    showAdvanced,
    showTokenNote = false,
    tokenPlaceholder,
    tokenAction,
    disabled = false,
    onDraftChange,
    onShowTokenChange,
    onShowAdvancedChange,
}: {
    draft: AddDraft;
    showToken: boolean;
    showAdvanced: boolean;
    showTokenNote?: boolean;
    tokenPlaceholder: string;
    tokenAction?: {
        label: string;
        active?: boolean;
        loading?: boolean;
        cleared?: boolean;
        onClick: () => void;
    };
    disabled?: boolean;
    onDraftChange: (draft: AddDraft) => void;
    onShowTokenChange: (show: boolean) => void;
    onShowAdvancedChange: (show: boolean) => void;
}) {
    return (
        <div className="grid gap-3 pt-1">
            <label className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
                <span className="text-xs font-medium text-gray-500">
                    Label
                </span>
                <Input
                    value={draft.name}
                    onChange={(event) =>
                        onDraftChange({ ...draft, name: event.target.value })
                    }
                    placeholder="Connector label"
                    className={`h-8 text-sm ${accountGlassInputClassName}`}
                    disabled={disabled}
                />
            </label>
            <label className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
                <span className="text-xs font-medium text-gray-500">
                    URL endpoint
                </span>
                <Input
                    value={draft.serverUrl}
                    onChange={(event) =>
                        onDraftChange({
                            ...draft,
                            serverUrl: event.target.value,
                        })
                    }
                    placeholder="https://mcp.example.com/mcp"
                    className={`h-8 text-sm ${accountGlassInputClassName}`}
                    disabled={disabled}
                />
            </label>
            <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-start">
                <span className="pt-2 text-xs font-medium text-gray-500">
                    Bearer token
                </span>
                <div className="min-w-0">
                    <div className="relative">
                        <Input
                            value={draft.bearerToken}
                            onChange={(event) =>
                                onDraftChange({
                                    ...draft,
                                    bearerToken: event.target.value,
                                })
                            }
                            type={showToken ? "text" : "password"}
                            placeholder={tokenPlaceholder}
                            className={`h-8 ${
                                tokenAction
                                    ? draft.bearerToken
                                        ? "pr-[6.5rem]"
                                        : "pr-16"
                                    : "pr-10"
                            } text-sm ${accountGlassInputClassName}`}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={disabled}
                        />
                        {draft.bearerToken && (
                            <button
                                type="button"
                                className={`absolute inset-y-1 ${
                                    tokenAction ? "right-[3.75rem]" : "right-1.5"
                                } flex items-center ${accountGlassIconButtonClassName}`}
                                onClick={() => onShowTokenChange(!showToken)}
                                aria-label={
                                    showToken ? "Hide token" : "Show token"
                                }
                                disabled={disabled}
                            >
                                {showToken ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        )}
                        {tokenAction && (
                            <button
                                type="button"
                                onClick={tokenAction.onClick}
                                disabled={
                                    disabled ||
                                    tokenAction.loading ||
                                    tokenAction.cleared
                                }
                                className={`absolute inset-y-1 right-1.5 px-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${
                                    tokenAction.active || tokenAction.cleared
                                        ? "text-red-600 hover:text-red-700"
                                        : "text-gray-500 hover:text-gray-900"
                                }`}
                            >
                                <span className="inline-flex items-center gap-1">
                                    {tokenAction.label}
                                    {tokenAction.loading && (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    )}
                                </span>
                            </button>
                        )}
                    </div>
                    {showTokenNote && (
                        <p className="mt-1 text-right text-xs text-gray-500">
                            Tokens are stored encrypted.
                        </p>
                    )}
                </div>
            </div>
            <div className="grid gap-2">
                <button
                    type="button"
                    onClick={() => onShowAdvancedChange(!showAdvanced)}
                    className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
                    disabled={disabled}
                >
                    Advanced
                    <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                            showAdvanced ? "" : "-rotate-90"
                        }`}
                    />
                </button>
                {showAdvanced && (
                    <label className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-start">
                        <span className="text-xs font-medium text-gray-500">
                            Custom headers
                        </span>
                        <div className="min-w-0">
                            <textarea
                                value={draft.customHeaders}
                                onChange={(event) =>
                                    onDraftChange({
                                        ...draft,
                                        customHeaders: event.target.value,
                                    })
                                }
                                placeholder='{"X-API-Key":"secret"}'
                                className={`min-h-20 w-full resize-y rounded-lg px-3 py-2 text-sm outline-none ${accountGlassInputClassName}`}
                                autoComplete="off"
                                spellCheck={false}
                                disabled={disabled}
                            />
                            <p className="mt-1 text-right text-xs text-gray-500">
                                Secrets are stored encrypted.
                            </p>
                        </div>
                    </label>
                )}
            </div>
        </div>
    );
}

export function ToolListSkeleton({
    count,
    fill = false,
}: {
    count: number;
    fill?: boolean;
}) {
    const rowCount = Math.min(Math.max(count || 3, 3), 8);
    return (
        <div
            className={`overflow-hidden rounded-lg border border-gray-100 bg-white/60 ${
                fill ? "min-h-0 flex-1" : "max-h-72"
            }`}
        >
            <div className="divide-y divide-gray-100">
                {Array.from({ length: rowCount }).map((_, index) => (
                    <div key={index} className="px-3 py-2">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                            <div className="h-5 w-5" />
                            <div className="h-3.5 w-full max-w-[220px] animate-pulse rounded bg-gray-100" />
                            <div className="h-4 w-7 animate-pulse rounded-full bg-gray-100" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ScrollableToolList({
    connector,
    busyKey,
    onToolEnabled,
    fill = false,
}: {
    connector: McpConnectorSummary;
    busyKey?: string | null;
    onToolEnabled?: (
        connectorId: string,
        toolId: string,
        enabled: boolean,
    ) => Promise<void>;
    fill?: boolean;
}) {
    const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

    if (connector.tools.length === 0) {
        return (
            <div
                className={`rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-500 ${
                    fill ? "min-h-0 flex-1" : ""
                }`}
            >
                No tools discovered yet.
            </div>
        );
    }

    return (
        <div
            className={`overflow-y-auto rounded-lg border border-gray-100 bg-white/60 ${
                fill ? "min-h-0 flex-1" : "max-h-72"
            }`}
        >
            <div className="divide-y divide-gray-100">
                {connector.tools.map((tool) => {
                    const disabled =
                        !onToolEnabled ||
                        busyKey === `tool:${tool.id}` ||
                        tool.requiresConfirmation;
                    const isExpanded = expandedToolId === tool.id;
                    const toolLabel = tool.title || tool.toolName;
                    return (
                        <div key={tool.id} className="px-3 py-2">
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandedToolId(
                                            isExpanded ? null : tool.id,
                                        )
                                    }
                                    className="inline-flex h-5 w-5 items-center justify-center text-gray-400 transition-colors hover:text-gray-800"
                                    aria-label={`${
                                        isExpanded ? "Collapse" : "Expand"
                                    } ${toolLabel}`}
                                >
                                    <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                            isExpanded ? "" : "-rotate-90"
                                        }`}
                                    />
                                </button>
                                <p className="min-w-0 truncate text-sm font-medium text-gray-800">
                                    {toolLabel}
                                </p>
                                {onToolEnabled ? (
                                    <AccountToggle
                                        checked={tool.enabled}
                                        disabled={disabled}
                                        loading={busyKey === `tool:${tool.id}`}
                                        onChange={(enabled) =>
                                            void onToolEnabled(
                                                connector.id,
                                                tool.id,
                                                enabled,
                                            )
                                        }
                                    />
                                ) : (
                                    <span
                                        className={`text-xs font-medium ${
                                            tool.enabled
                                                ? "text-green-600"
                                                : "text-gray-500"
                                        }`}
                                    >
                                        {tool.enabled ? "Enabled" : "Disabled"}
                                    </span>
                                )}
                            </div>
                            {isExpanded && (
                                <div className="ml-7 mt-2 min-w-0">
                                    {tool.requiresConfirmation && (
                                        <p className="text-xs font-medium text-amber-700">
                                            Confirmation required
                                        </p>
                                    )}
                                    {tool.description && (
                                        <p className="mt-1 text-xs text-gray-500">
                                            {tool.description}
                                        </p>
                                    )}
                                    <p className="mt-1 break-all font-mono text-[11px] text-gray-400">
                                        {tool.openaiToolName}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
