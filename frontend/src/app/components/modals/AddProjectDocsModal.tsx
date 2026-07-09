"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload, X } from "lucide-react";
import { SearchBar } from "@/app/components/ui/search-bar";
import { getProject, uploadProjectDocument } from "@/app/lib/mikeApi";
import type { Document } from "../shared/types";
import { DocFileIcon } from "../shared/FileDirectory";
import { VersionChip } from "../shared/VersionChip";
import { Modal } from "./Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (documents: Document[]) => void;
    breadcrumb: string[];
    projectId: string;
    /** Docs already in the target list — rendered checked + disabled. */
    excludeDocIds?: Set<string>;
    allowMultiple?: boolean;
}

function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export function AddProjectDocsModal({
    open,
    onClose,
    onSelect,
    breadcrumb,
    projectId,
    excludeDocIds,
    allowMultiple = true,
}: Props) {
    const [docs, setDocs] = useState<Document[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setSearch("");
        setSelectedIds(new Set());
        let cancelled = false;
        setLoading(true);
        getProject(projectId)
            .then((p) => {
                if (!cancelled) setDocs(p.documents ?? []);
            })
            .catch(() => {
                if (!cancelled) setDocs([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, projectId]);

    if (!open) return null;

    const q = search.toLowerCase().trim();
    const filtered = q
        ? docs.filter((d) => d.filename.toLowerCase().includes(q))
        : docs;

    const isExcluded = (id: string) => !!excludeDocIds?.has(id);

    function toggle(id: string) {
        if (isExcluded(id)) return;
        if (!allowMultiple) {
            setSelectedIds(new Set([id]));
            return;
        }
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    function handleConfirm() {
        const selected = docs.filter((d) => selectedIds.has(d.id));
        onSelect(selected);
        onClose();
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setUploading(true);
        try {
            const uploaded = await Promise.all(
                files.map((f) => uploadProjectDocument(projectId, f)),
            );
            setDocs((prev) => [...uploaded, ...prev]);
            setSelectedIds((prev) => {
                const next = new Set(prev);
                uploaded.forEach((d) => next.add(d.id));
                return next;
            });
        } catch (err) {
            console.error("Upload failed:", err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={breadcrumb}
            secondaryAction={{
                label: uploading ? "Uploading…" : "Upload",
                icon: uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Upload className="h-3.5 w-3.5" />
                ),
                onClick: () => fileInputRef.current?.click(),
                disabled: uploading,
            }}
            footerStatus={
                selectedIds.size > 0 ? (
                    <span className="text-xs text-gray-400">
                        {selectedIds.size} selected
                    </span>
                ) : null
            }
            primaryAction={{
                label: "Confirm",
                onClick: handleConfirm,
                disabled: selectedIds.size === 0 || uploading,
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt"
                multiple
                className="hidden"
                onChange={handleUpload}
            />
            <div className="pt-1 pb-2">
                <SearchBar
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search..."
                    autoFocus
                />
            </div>

            {/* File list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
                <div className="rounded-sm border border-gray-100 overflow-hidden">
                    {[60, 45, 75, 55, 40].map((w, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-2 px-2 py-2"
                        >
                            <div className="h-3.5 w-3.5 rounded border border-gray-200 shrink-0" />
                            <div className="h-3.5 w-3.5 rounded bg-gray-100 animate-pulse shrink-0" />
                            <div
                                className="h-3 rounded bg-gray-100 animate-pulse"
                                style={{ width: `${w}%` }}
                            />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">
                    {q ? "No matches found" : "No documents in this project"}
                </p>
            ) : (
                <div className="rounded-sm border border-gray-100 overflow-hidden">
                    {filtered.map((doc) => {
                        const excluded = isExcluded(doc.id);
                        const checked = excluded || selectedIds.has(doc.id);
                        return (
                            <button
                                type="button"
                                key={doc.id}
                                disabled={excluded}
                                onClick={() => toggle(doc.id)}
                                className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-xs text-left transition-all ${
                                    excluded
                                        ? "opacity-50 cursor-not-allowed"
                                        : checked
                                          ? "bg-gray-100"
                                          : "hover:bg-gray-100/70"
                                }`}
                            >
                                <span
                                    className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                                        checked
                                            ? "bg-gray-900 border-gray-900"
                                            : "border-gray-300"
                                    }`}
                                >
                                    {checked && (
                                        <Check className="h-2.5 w-2.5 text-white" />
                                    )}
                                </span>
                                <DocFileIcon fileType={doc.file_type} />
                                <span
                                    className={`flex-1 truncate ${
                                        checked
                                            ? "text-gray-900"
                                            : "text-gray-700"
                                    }`}
                                >
                                    {doc.filename}
                                </span>
                                {excluded && (
                                    <span className="text-[10px] text-gray-400 shrink-0">
                                        Already added
                                    </span>
                                )}
                                <VersionChip
                                    n={
                                        doc.active_version_number ??
                                        doc.latest_version_number
                                    }
                                />
                                {doc.created_at && (
                                    <span className="shrink-0 text-gray-300">
                                        {formatDate(doc.created_at)}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
            </div>
        </Modal>
    );
}
