"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import {
    getAuditHistory,
    exportAuditHistory,
    type AuditEvent,
} from "@/app/lib/mikeApi";
import { accountGlassInputClassName } from "../account/accountStyles";
import { AccountSection } from "../account/AccountSection";

const ACTION_LABELS: Record<string, string> = {
    "chat.message": "Chat",
    "document.uploaded": "Document upload",
    "document.generated": "Generated document",
    "document.edited": "Document edit",
    "workflow.applied": "Workflow",
    "tabular.created": "Tabular review",
    "tabular.generated": "Tabular run",
    "export.chats": "Chat export",
    "export.account": "Account export",
    "export.tabular": "Review export",
};

const STATUS_STYLES: Record<string, string> = {
    completed: "bg-green-50 text-green-700",
    cancelled: "bg-amber-50 text-amber-700",
    failed: "bg-red-50 text-red-700",
};

function eventHref(e: AuditEvent): string | null {
    if (e.chat_id) {
        return e.project_id
            ? `/projects/${e.project_id}/assistant/chat/${e.chat_id}`
            : `/assistant/chat/${e.chat_id}`;
    }
    if (e.review_id) return `/tabular-reviews/${e.review_id}`;
    if (e.project_id) return `/projects/${e.project_id}`;
    return null;
}

export default function HistoryPage() {
    return (
        <div className="flex h-full flex-col overflow-y-auto">
            <header className="mx-auto flex h-16 w-full max-w-[1400px] shrink-0 items-end px-6 pb-2 md:h-24 md:pb-4">
                <h1 className="text-4xl font-medium font-eb-garamond">
                    History
                </h1>
            </header>
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 pb-10 pt-2">
                <HistoryTable />
            </main>
        </div>
    );
}

function HistoryTable() {
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [q, setQ] = useState("");
    const [action, setAction] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    // Tracks the in-flight request so a newer load can abort an older one.
    // Without this, rapid filter changes race: a slow first response could land
    // after a faster second one and overwrite it with stale rows, and a
    // "Load more" issued mid-filter-change would append a page from the old
    // filter (duplicate key={e.id} warnings and wrong rows).
    const controllerRef = useRef<AbortController | null>(null);

    const load = useCallback(
        async (nextPage: number, append: boolean) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            setLoading(true);
            try {
                const out = await getAuditHistory(
                    {
                        q: q || undefined,
                        action: action || undefined,
                        from: from || undefined,
                        to: to || undefined,
                        page: nextPage,
                    },
                    controller.signal,
                );
                if (controller.signal.aborted) return;
                setError(false);
                setEvents((cur) => (append ? [...cur, ...out.events] : out.events));
                setTotal(out.total);
                setPage(nextPage);
            } catch (err) {
                // A superseded request rejects with an AbortError — ignore it so
                // it neither clears the newer results nor shows a false error.
                if (controller.signal.aborted) return;
                if (!append) {
                    setEvents([]);
                    setTotal(0);
                }
                setError(true);
            } finally {
                if (controllerRef.current === controller) setLoading(false);
            }
        },
        [q, action, from, to],
    );

    useEffect(() => {
        void load(1, false);
        return () => controllerRef.current?.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter change only
    }, [action, from, to]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const { blob, filename } = await exportAuditHistory({
                q: q || undefined,
                action: action || undefined,
                from: from || undefined,
                to: to || undefined,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename ?? "history-export.csv";
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            alert("Export failed.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <div>
            <p className="mb-4 text-sm text-gray-500">
                Your actions, plus activity in projects shared with you.
            </p>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void load(1, false);
                        }}
                        placeholder="Search history"
                        className={`h-9 w-full pl-8 ${accountGlassInputClassName}`}
                    />
                </div>
                <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    className={`h-9 ${accountGlassInputClassName}`}
                >
                    <option value="">All types</option>
                    {Object.entries(ACTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className={`h-9 ${accountGlassInputClassName}`}
                    aria-label="From date"
                />
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={`h-9 ${accountGlassInputClassName}`}
                    aria-label="To date"
                />
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-45"
                >
                    {exporting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Download className="h-3.5 w-3.5" />
                    )}
                    Export
                </button>
            </div>

            <AccountSection>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wider text-gray-400">
                                <th className="px-4 py-2.5 font-medium">User</th>
                                <th className="px-4 py-2.5 font-medium">Created</th>
                                <th className="px-4 py-2.5 font-medium">Title</th>
                                <th className="px-4 py-2.5 font-medium">Status</th>
                                <th className="px-4 py-2.5 font-medium">Type</th>
                                <th className="px-4 py-2.5 font-medium">Application</th>
                                <th className="px-4 py-2.5 font-medium">Model</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((e) => {
                                const href = eventHref(e);
                                return (
                                    <tr
                                        key={e.id}
                                        className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60"
                                    >
                                        <td className="max-w-[140px] truncate px-4 py-2.5 text-gray-600">
                                            {e.user_email ?? "—"}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                                            {new Date(e.created_at).toLocaleString(
                                                undefined,
                                                {
                                                    dateStyle: "medium",
                                                    timeStyle: "short",
                                                },
                                            )}
                                        </td>
                                        <td className="max-w-[280px] truncate px-4 py-2.5 text-gray-900">
                                            {href ? (
                                                <a
                                                    href={href}
                                                    className="hover:underline"
                                                >
                                                    {e.title ?? "—"}
                                                </a>
                                            ) : (
                                                (e.title ?? "—")
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[e.status] ?? "bg-gray-100 text-gray-600"}`}
                                            >
                                                {e.status}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                                            {ACTION_LABELS[e.action] ?? e.action}
                                        </td>
                                        <td className="px-4 py-2.5 capitalize text-gray-600">
                                            {e.surface ?? "—"}
                                        </td>
                                        <td className="max-w-[150px] truncate px-4 py-2.5 text-gray-600">
                                            {e.model ?? "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                            {!loading && error && events.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-4 py-8 text-center text-sm text-red-500"
                                    >
                                        Couldn&apos;t load your history.{" "}
                                        <button
                                            type="button"
                                            onClick={() => void load(1, false)}
                                            className="font-medium underline hover:text-red-600"
                                        >
                                            Try again
                                        </button>
                                    </td>
                                </tr>
                            )}
                            {!loading && !error && events.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-4 py-8 text-center text-sm text-gray-400"
                                    >
                                        No history yet — actions appear here as
                                        you use the app.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {loading && (
                    <div className="flex justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    </div>
                )}
                {!loading && events.length < total && (
                    <div className="flex justify-center border-t border-gray-100 py-3">
                        <button
                            type="button"
                            onClick={() => void load(page + 1, true)}
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                            Load more ({events.length} of {total})
                        </button>
                    </div>
                )}
            </AccountSection>
        </div>
    );
}
