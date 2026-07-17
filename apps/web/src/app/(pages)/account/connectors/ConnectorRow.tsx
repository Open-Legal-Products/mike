import { type McpConnectorSummary } from "@/app/lib/mikeApi";
import { AccountSection } from "../AccountSection";
import { AccountToggle } from "../AccountToggle";

// Loading skeleton + a single connector row for the Connectors list.

export function ConnectorsSkeleton() {
    return (
        <>
            {Array.from({ length: 3 }).map((_, index) => (
                <AccountSection key={index} className="px-4 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3">
                        <div className="flex min-h-5 min-w-0 items-center gap-2">
                            <div className="h-3.5 w-28 animate-pulse rounded bg-gray-100" />
                            <div className="h-1 w-1 rounded-full bg-gray-100" />
                            <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
                        </div>
                        <div className="flex min-h-5 shrink-0 items-center justify-self-end gap-1.5">
                            <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
                            <div className="h-4 w-7 animate-pulse rounded-full bg-gray-100" />
                        </div>
                        <div className="flex min-h-4 min-w-0 items-center">
                            <div className="h-3 w-full max-w-sm animate-pulse rounded bg-gray-100" />
                        </div>
                        <div className="flex min-h-4 items-center justify-self-end">
                            <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
                        </div>
                    </div>
                </AccountSection>
            ))}
        </>
    );
}

export function ConnectorRow({
    connector,
    busyKey,
    onOpen,
    onConnectorEnabled,
}: {
    connector: McpConnectorSummary;
    busyKey: string | null;
    onOpen: () => void;
    onConnectorEnabled: (
        connectorId: string,
        enabled: boolean,
    ) => Promise<void>;
}) {
    const toolCount = connector.toolCount ?? connector.tools.length;

    return (
        <AccountSection
            className="cursor-pointer px-4 py-3 transition-colors hover:bg-white/70"
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen();
                }
            }}
        >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3">
                <div className="min-w-0 text-left">
                    <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
                        <span className="truncate">{connector.name}</span>
                        <span className="h-1 w-1 rounded-full bg-gray-300" />
                        <span className="shrink-0 text-xs font-medium text-gray-500">
                            {toolCount} {toolCount === 1 ? "tool" : "tools"}
                        </span>
                    </h3>
                </div>
                <div
                    className="shrink-0 justify-self-end"
                    onClick={(event) => event.stopPropagation()}
                >
                    <AccountToggle
                        checked={connector.enabled}
                        disabled={busyKey === `connector:${connector.id}`}
                        loading={busyKey === `connector:${connector.id}`}
                        label={connector.enabled ? "Enabled" : "Disabled"}
                        onChange={(enabled) =>
                            void onConnectorEnabled(connector.id, enabled)
                        }
                    />
                </div>
                <p className="min-w-0 truncate text-xs text-gray-500">
                    {connector.serverUrl}
                </p>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpen();
                    }}
                    className="shrink-0 justify-self-end text-xs font-medium text-gray-500 transition-colors hover:text-gray-950"
                >
                    Details
                </button>
            </div>
        </AccountSection>
    );
}
