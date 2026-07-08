"use client";

import { Check, ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { Modal } from "@/app/components/modals/Modal";
import type { McpConnectorSummary } from "@/app/lib/mikeApi";
import {
    accountGlassIconButtonClassName,
    accountGlassInputClassName,
} from "@/app/(pages)/account/accountStyles";

export type NewMcpDraft = {
    name: string;
    serverUrl: string;
    bearerToken: string;
    customHeaders: string;
};

export type NewMcpStep = "form" | "working" | "auth" | "success";

interface NewMcpModalProps {
    open: boolean;
    draft: NewMcpDraft;
    step: NewMcpStep;
    result: McpConnectorSummary | null;
    error: string | null;
    authMessage: string | null;
    showToken: boolean;
    showAdvanced: boolean;
    onDraftChange: (draft: NewMcpDraft) => void;
    onShowTokenChange: (show: boolean) => void;
    onShowAdvancedChange: (show: boolean) => void;
    onClose: () => void;
    onSubmit: () => Promise<void>;
    onOpenConnector: (connectorId: string) => void;
}

export function NewMcpModal({
    open,
    draft,
    step,
    result,
    error,
    authMessage,
    showToken,
    showAdvanced,
    onDraftChange,
    onShowTokenChange,
    onShowAdvancedChange,
    onClose,
    onSubmit,
    onOpenConnector,
}: NewMcpModalProps) {
    const canSubmit =
        draft.name.trim().length > 0 &&
        draft.serverUrl.trim().length > 0 &&
        step !== "working" &&
        step !== "auth";

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={[
                "Connectors",
                step === "success"
                    ? "Connector added"
                    : step === "auth"
                      ? "Authenticate connector"
                      : "New MCP connector",
            ]}
            size="lg"
            primaryAction={
                step === "success" && result
                    ? {
                          label: "View connector",
                          onClick: () => onOpenConnector(result.id),
                      }
                    : {
                          label:
                              step === "working"
                                  ? "Connecting..."
                                  : step === "auth"
                                    ? "Authorizing..."
                                    : "Connect",
                          icon:
                              step === "working" || step === "auth" ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                              ) : undefined,
                          onClick: () => void onSubmit(),
                          disabled: !canSubmit,
                      }
            }
            cancelAction={
                step === "working" || step === "auth"
                    ? false
                    : {
                          label: step === "success" ? "Done" : "Cancel",
                          onClick: onClose,
                      }
            }
            footerStatus={
                error ? (
                    <div className="rounded-xl border border-white/70 bg-white/75 px-3 py-2 text-sm text-red-600 shadow-[0_12px_32px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-xl">
                        {error}
                    </div>
                ) : null
            }
        >
            {step === "success" && result ? (
                <NewMcpSuccess connector={result} />
            ) : step === "auth" ? (
                <NewMcpAuth
                    message={
                        authMessage ??
                        "Complete authorization in the popup to finish connecting this MCP server."
                    }
                />
            ) : (
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
                    <p className="text-sm text-gray-500">
                        The assistant will have access to this MCP server and
                        its enabled tools.
                    </p>
                    <NewMcpForm
                        draft={draft}
                        showToken={showToken}
                        showAdvanced={showAdvanced}
                        disabled={step === "working"}
                        onDraftChange={onDraftChange}
                        onShowTokenChange={onShowTokenChange}
                        onShowAdvancedChange={onShowAdvancedChange}
                    />
                </div>
            )}
        </Modal>
    );
}

function NewMcpForm({
    draft,
    showToken,
    showAdvanced,
    disabled,
    onDraftChange,
    onShowTokenChange,
    onShowAdvancedChange,
}: {
    draft: NewMcpDraft;
    showToken: boolean;
    showAdvanced: boolean;
    disabled: boolean;
    onDraftChange: (draft: NewMcpDraft) => void;
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
                            placeholder="Bearer token"
                            className={`h-8 pr-10 text-sm ${accountGlassInputClassName}`}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={disabled}
                        />
                        {draft.bearerToken && (
                            <button
                                type="button"
                                className={`absolute inset-y-1 right-1.5 flex items-center ${accountGlassIconButtonClassName}`}
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
                    </div>
                    <p className="mt-1 text-right text-xs text-gray-500">
                        Tokens are stored encrypted.
                    </p>
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

function NewMcpSuccess({ connector }: { connector: McpConnectorSummary }) {
    return (
        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 pb-4">
            <div className="flex items-start gap-3 rounded-xl border border-green-100/80 bg-green-50/80 px-3 py-3 text-green-800 shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)] backdrop-blur-xl">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <p className="min-w-0 truncate text-sm font-medium">
                    {connector.name} is connected.{" "}
                    <span className="font-normal text-green-700">
                        {connector.tools.length} tools discovered.
                    </span>
                </p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-100 bg-white/60">
                <div className="max-h-full overflow-y-auto divide-y divide-gray-100">
                    {connector.tools.map((tool) => (
                        <div
                            key={tool.openaiToolName}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
                        >
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-800">
                                    {tool.title ?? tool.openaiToolName}
                                </p>
                                {tool.description && (
                                    <p className="truncate text-xs text-gray-500">
                                        {tool.description}
                                    </p>
                                )}
                            </div>
                            <span className="text-xs text-gray-400">
                                {tool.enabled ? "Enabled" : "Disabled"}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function NewMcpAuth({ message }: { message: string }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 pb-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/70 bg-white/75 text-gray-700 shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)] backdrop-blur-xl">
                <Loader2 className="h-4 w-4 animate-spin" />
            </div>
            <div className="max-w-sm space-y-1">
                <h3 className="text-sm font-medium text-gray-900">
                    Authentication required
                </h3>
                <p className="text-sm text-gray-500">{message}</p>
            </div>
        </div>
    );
}
