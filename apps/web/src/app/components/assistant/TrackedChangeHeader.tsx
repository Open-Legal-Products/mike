"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { PillButton } from "@/app/components/ui/pill-button";
import { applyOptimisticResolution } from "./EditCard";
import type { EditAnnotation } from "../shared/types";

const PANEL_GLASS_SURFACE =
    "rounded-2xl bg-white/58 shadow-[0_5px_15px_rgba(15,23,42,0.095),inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-8px_16px_rgba(255,255,255,0.16)] backdrop-blur-2xl";
const PANEL_CARD_SURFACE = "rounded-lg bg-gray-100";

type ResolveArgs = {
    editId: string;
    documentId: string;
    verb: "accept" | "reject";
};

type ResolvedArgs = {
    editId: string;
    documentId: string;
    status: "accepted" | "rejected";
    versionId: string | null;
    downloadUrl: string | null;
};

type ErrorArgs = {
    editId: string;
    documentId: string;
    versionId: string | null;
    message: string;
};

export function TrackedChangeHeader({
    edit,
    changeNumber,
    isEditReloading,
    onResolveStart,
    onResolved,
    onError,
    onHighlight,
}: {
    edit: EditAnnotation;
    changeNumber?: number;
    isEditReloading?: boolean;
    onResolveStart?: (args: ResolveArgs) => void;
    onResolved?: (args: ResolvedArgs) => void;
    onError?: (args: ErrorArgs) => void;
    onHighlight?: () => void;
}) {
    return (
        <div className="px-3 pb-3">
            <div className={`${PANEL_GLASS_SURFACE} px-2 py-2`}>
                <div className="mb-1 flex items-center gap-2">
                    <p className="text-xs font-medium text-gray-700">
                        Tracked Change
                        {changeNumber !== undefined ? ` ${changeNumber}` : ""}
                    </p>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <EditResolveButtons
                            edit={edit}
                            isReloading={isEditReloading}
                            onResolveStart={onResolveStart}
                            onResolved={onResolved}
                            onError={onError}
                        />
                    </div>
                </div>
                {edit.reason && (
                    <p className="mb-3 text-xs text-gray-500">{edit.reason}</p>
                )}
                <div
                    className={`w-full px-3 py-2.5 text-left transition-colors ${PANEL_CARD_SURFACE} ${
                        onHighlight ? "cursor-pointer hover:bg-gray-200/70" : ""
                    }`}
                    role={onHighlight ? "button" : undefined}
                    tabIndex={onHighlight ? 0 : undefined}
                    onClick={onHighlight}
                    onKeyDown={(event) => {
                        if (!onHighlight) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onHighlight();
                    }}
                >
                    <div className="font-serif text-sm leading-relaxed">
                        {edit.inserted_text && (
                            <span className="text-green-700">
                                {edit.inserted_text}
                            </span>
                        )}
                        {edit.deleted_text && (
                            <span className="text-red-600 line-through">
                                {edit.deleted_text}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function EditResolveButtons({
    edit,
    isReloading,
    onResolveStart,
    onResolved,
    onError,
}: {
    edit: EditAnnotation;
    isReloading?: boolean;
    onResolveStart?: (args: ResolveArgs) => void;
    onResolved?: (args: ResolvedArgs) => void;
    onError?: (args: ErrorArgs) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<"pending" | "accepted" | "rejected">(
        edit.status,
    );

    useEffect(() => {
        if (busy) return;
        setStatus(edit.status);
    }, [edit.status, edit.edit_id, busy]);

    const resolved = status !== "pending";

    const handle = useCallback(
        async (verb: "accept" | "reject") => {
            if (busy || resolved) return;
            setBusy(true);
            onResolveStart?.({
                editId: edit.edit_id,
                documentId: edit.document_id,
                verb,
            });
            let revert: (() => void) | null = null;
            try {
                revert = applyOptimisticResolution(edit, verb);
            } catch (e) {
                console.error(
                    "[TrackedChangeHeader] optimistic update threw",
                    e,
                );
            }
            try {
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                const apiBase =
                    process.env.NEXT_PUBLIC_API_BASE_URL ??
                    "http://localhost:3001";
                const resp = await fetch(
                    `${apiBase}/single-documents/${edit.document_id}/edits/${edit.edit_id}/${verb}`,
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
                setStatus(nextStatus);
                onResolved?.({
                    editId: edit.edit_id,
                    documentId: edit.document_id,
                    status: nextStatus,
                    versionId: data.version_id,
                    downloadUrl: data.download_url,
                });
            } catch (e) {
                console.error("[TrackedChangeHeader] resolve failed", e);
                try {
                    revert?.();
                } catch (revertErr) {
                    console.error(
                        "[TrackedChangeHeader] revert threw",
                        revertErr,
                    );
                }
                onError?.({
                    editId: edit.edit_id,
                    documentId: edit.document_id,
                    versionId: edit.version_id ?? null,
                    message:
                        verb === "accept"
                            ? "Couldn't save accept — please retry."
                            : "Couldn't save reject — please retry.",
                });
            } finally {
                setBusy(false);
            }
        },
        [busy, resolved, edit, onResolveStart, onResolved, onError],
    );

    const inFlight = busy || !!isReloading;
    return (
        <div className="flex items-center gap-2">
            <PillButton
                tone="black"
                size="sm"
                onClick={() => handle("accept")}
                disabled={inFlight || resolved}
            >
                {status === "accepted" ? "Accepted" : "Accept"}
            </PillButton>
            <PillButton
                tone="white"
                size="sm"
                onClick={() => handle("reject")}
                disabled={inFlight || resolved}
            >
                {status === "rejected" ? "Rejected" : "Reject"}
            </PillButton>
        </div>
    );
}
