import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { PillButton } from "@/app/components/ui/pill-button";
import { supabase } from "@/app/lib/supabase";
import type { EditAnnotation } from "../../shared/types";
import { applyOptimisticResolution } from "../EditCard";

/**
 * Card rendered above the per-edit EditCards when a message produced
 * multiple tracked-change proposals. Lets the user resolve every pending
 * edit in one click by firing the per-edit accept/reject endpoint for each
 * pending annotation and forwarding each response to `onResolved` so the
 * parent can bump the viewer version, persist override URLs, etc.
 *
 * This intentionally doesn't apply the optimistic DOM mutation that
 * EditCard does — bulk operations touch many edits at once and the real
 * re-render from the latest version will reconcile within a second or so.
 */
function BulkEditActions({
    pending,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
}: {
    pending: {
        annotation: EditAnnotation;
        filename: string;
    }[];
    onViewClick?: (ann: EditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
}) {
    const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
    const [progress, setProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);

    if (pending.length === 0) return null;

    const handleAll = async (verb: "accept" | "reject") => {
        if (busy) return;
        setBusy(verb);
        setProgress({ done: 0, total: pending.length });
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const apiBase =
                process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

            // Sequential so the per-document version counter advances in a
            // predictable order and the viewer doesn't race between bumps.
            let done = 0;
            for (const { annotation } of pending) {
                onResolveStart?.({
                    editId: annotation.edit_id,
                    documentId: annotation.document_id,
                    verb,
                });
                // Optimistically mutate the DOM so the viewer reflects the
                // resolution immediately. Revert if the backend call fails.
                let revert: (() => void) | null = null;
                try {
                    revert = applyOptimisticResolution(annotation, verb);
                } catch (e) {
                    console.error(
                        "[BulkEditActions] optimistic update threw",
                        e,
                    );
                }
                try {
                    const resp = await fetch(
                        `${apiBase}/single-documents/${annotation.document_id}/edits/${annotation.edit_id}/${verb}`,
                        {
                            method: "POST",
                            headers: token
                                ? { Authorization: `Bearer ${token}` }
                                : undefined,
                        },
                    );
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = (await resp.json()) as {
                        ok: boolean;
                        status?: "accepted" | "rejected";
                        version_id: string | null;
                        download_url: string | null;
                    };
                    const nextStatus =
                        data.status ??
                        (verb === "accept" ? "accepted" : "rejected");
                    onResolved?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        status: nextStatus,
                        versionId: data.version_id,
                        downloadUrl: data.download_url,
                    });
                } catch (e) {
                    console.error("[BulkEditActions] resolve failed", e);
                    try {
                        revert?.();
                    } catch (revertErr) {
                        console.error(
                            "[BulkEditActions] revert threw",
                            revertErr,
                        );
                    }
                    onError?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        versionId: annotation.version_id ?? null,
                        message:
                            verb === "accept"
                                ? "Couldn't save one or more accepts."
                                : "Couldn't save one or more rejects.",
                    });
                }
                done++;
                setProgress({ done, total: pending.length });
            }
        } finally {
            setBusy(null);
            setProgress(null);
        }
    };

    // Optional: show a tiny "View first" action so bulk doesn't lose the
    // in-viewer scroll-to behaviour entirely.
    const first = pending[0];

    return (
        <div className="flex items-center gap-2">
            <PillButton
                tone="black"
                size="sm"
                onClick={() => handleAll("accept")}
                disabled={!!busy}
            >
                {busy === "accept" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Accept all
            </PillButton>
            <PillButton
                tone="white"
                size="sm"
                onClick={() => handleAll("reject")}
                disabled={!!busy}
            >
                {busy === "reject" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Reject all
            </PillButton>
            {progress && (
                <span className="text-xs font-serif text-gray-500">
                    {progress.done}/{progress.total}
                </span>
            )}
            {onViewClick && first && (
                <PillButton
                    tone="blue"
                    size="sm"
                    onClick={() =>
                        onViewClick(first.annotation, first.filename)
                    }
                    disabled={!!busy}
                    className="ml-auto"
                >
                    View
                </PillButton>
            )}
        </div>
    );
}

/**
 * Wraps the bulk accept/reject card and the per-edit EditCards in a single
 * minimisable container. The bulk actions and summary stay visible in the
 * header; the individual cards collapse via the chevron toggle.
 */
export function EditCardsSection({
    pending,
    filenameByDocId,
    cards,
    resolvedCount,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
}: {
    pending: {
        annotation: EditAnnotation;
        filename: string;
    }[];
    filenameByDocId: Map<string, string>;
    cards: ReactNode[];
    resolvedCount: number;
    onViewClick?: (ann: EditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);
    if (cards.length === 0) return null;

    const docCount = filenameByDocId.size;
    const summary =
        pending.length > 0
            ? docCount > 1
                ? `${pending.length} tracked changes across ${docCount} documents`
                : `${pending.length} tracked ${pending.length === 1 ? "change" : "changes"}`
            : docCount > 1
              ? `${resolvedCount} resolved tracked changes across ${docCount} documents`
              : `${resolvedCount} resolved tracked ${resolvedCount === 1 ? "change" : "changes"}`;

    return (
        <div className="rounded-xl bg-white shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)] backdrop-blur-2xl overflow-hidden">
            {/* Row 1: summary + chevron */}
            <div className="flex items-center gap-2 px-3 pt-3">
                <p className="flex-1 min-w-0 text-sm font-serif text-gray-700 truncate">
                    {summary}
                </p>
                <button
                    onClick={() => setIsOpen((v) => !v)}
                    aria-label={isOpen ? "Collapse edits" : "Expand edits"}
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                >
                    <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                </button>
            </div>
            {/* Row 2: bulk action buttons */}
            {pending.length > 0 && (
                <div className="px-3 pt-3">
                    <BulkEditActions
                        pending={pending}
                        onViewClick={onViewClick}
                        onResolveStart={onResolveStart}
                        onResolved={onResolved}
                        onError={onError}
                    />
                </div>
            )}
            {/* Row 3: collapsible cards list */}
            {isOpen && (
                <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
                    {cards}
                </div>
            )}
            {!isOpen && <div className="pb-3" />}
        </div>
    );
}
