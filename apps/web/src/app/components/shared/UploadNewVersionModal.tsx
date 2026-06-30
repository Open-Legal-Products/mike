"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { listDocumentVersions } from "@/app/lib/mikeApi";
import type { Document } from "./types";
import { Modal } from "./Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    doc: Document | null;
    onSubmit: (file: File, filename: string) => Promise<void>;
}

export function UploadNewVersionModal({ open, onClose, doc, onSubmit }: Props) {
    const [name, setName] = useState("");
    const [stagedFile, setStagedFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [currentVersion, setCurrentVersion] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || !doc) return;
        setName(doc.filename);
        setStagedFile(null);
        setSubmitting(false);
        setCurrentVersion(null);
        let cancelled = false;
        (async () => {
            try {
                const { current_version_id, versions } =
                    await listDocumentVersions(doc.id);
                const current = versions.find(
                    (v) => v.id === current_version_id,
                );
                const initial =
                    (current?.filename && current.filename.trim()) ||
                    doc.filename;
                if (!cancelled) {
                    setName(initial);
                    setCurrentVersion(current?.version_number ?? null);
                }
            } catch {
                /* keep fallback */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, doc]);

    if (!open || !doc) return null;

    const accept = ".pdf,.docx,.doc";

    function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0] ?? null;
        setStagedFile(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    async function handleSubmit() {
        if (!stagedFile || submitting || !doc) return;
        const finalName = name.trim() || doc.filename;
        setSubmitting(true);
        try {
            await onSubmit(stagedFile, finalName);
            onClose();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Upload new version", doc.filename]}
            secondaryAction={{
                label: stagedFile ? "Change file" : "Upload",
                icon: <Upload className="h-3.5 w-3.5" />,
                onClick: () => fileInputRef.current?.click(),
                disabled: submitting,
            }}
            primaryAction={{
                label: submitting ? "Saving…" : "Save",
                onClick: handleSubmit,
                disabled: !stagedFile || submitting,
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={handleFilePick}
            />
            <label className="block text-xs font-medium text-gray-500 mb-1">
                New version name
            </label>
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Version name"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <div className="mt-2 text-xs text-gray-500">
                Current Version:{" "}
                <span className="text-gray-700 font-medium">
                    {currentVersion ?? "—"}
                </span>
            </div>
            {stagedFile && (
                <div className="mt-2 text-xs text-gray-500 truncate">
                    New Version File:{" "}
                    <span className="text-gray-700">{stagedFile.name}</span>
                </div>
            )}
        </Modal>
    );
}
