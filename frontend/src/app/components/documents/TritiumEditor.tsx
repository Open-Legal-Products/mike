"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Document } from "@/app/components/shared/types";
import { getDocumentFile } from "@/app/lib/mikeApi";

type TritiumApi = {
    start: ({ folder, files }: { folder?: string; files: File[] }) => void;
    shutdown: () => void;
    open_file: (file: File) => Promise<void>;
    open_folder: (path: string, files: File[]) => Promise<void>;
    set_exit_handler: (handler: () => void) => void;
    set_save_handler: (
        handler: (file: File) => void | Promise<void>,
    ) => void;
};

const TRITIUM_SCRIPT_URL = "http://localhost:8080/static/init.js";

let tritiumModulePromise: Promise<TritiumApi> | null = null;

function loadTritium(): Promise<TritiumApi> {
    tritiumModulePromise ??= import(
        /* webpackIgnore: true */ TRITIUM_SCRIPT_URL
    ) as Promise<TritiumApi>;
    return tritiumModulePromise;
}

export function TritiumEditor({
    documents,
    folderName,
    onClose,
    onSave,
}: {
    documents: Document[];
    folderName?: string;
    onClose: () => void;
    onSave: (document: Document, file: File) => Promise<void>;
}) {
    const [error, setError] = useState<string | null>(null);
    const documentsRef = useRef(documents);
    const onCloseRef = useRef(onClose);
    const onSaveRef = useRef(onSave);
    const tritiumRef = useRef<TritiumApi | null>(null);
    documentsRef.current = documents;
    onCloseRef.current = onClose;
    onSaveRef.current = onSave;

    useEffect(() => {
        async function openTarget() {
            try {
                setError(null);
                const tritium = await loadTritium();
                tritiumRef.current = tritium;
                const fileResponses = await Promise.all(
                    documents.map(async (document) => ({
                        document,
                        response: await getDocumentFile(document.id),
                    })),
                );
                tritium.set_exit_handler(() => onCloseRef.current());
                tritium.set_save_handler(async (file) => {
                    const source = documentsRef.current.find(
                        (document) => document.filename === file.name,
                    );
                    if (!source) {
                        setError(
                            `Could not match ${file.name || "this file"} to a Library document.`,
                        );
                        return;
                    }
                    setError(null);
                    try {
                        await onSaveRef.current(source, file);
                    } catch (saveError) {
                        setError(
                            saveError instanceof Error
                                ? saveError.message
                                : "Could not save a new version.",
                        );
                    }
                });
                const files = fileResponses.map(({ document, response }) =>
                    new File(
                        [response.blob],
                        response.filename ?? document.filename,
                        { type: response.blob.type },
                    ),
                );
                tritium.start({ folder: folderName, files });
            } catch (openError) {
                setError(
                    openError instanceof Error
                        ? openError.message
                        : "Could not open this file in Tritium.",
                );
            }
        }
        void openTarget();
        return () => {};
    }, [documents, folderName]);

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-white">
            <header className="flex h-12 shrink-0 items-center border-b border-gray-200 px-4">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                    {folderName ?? documents[0]?.filename ?? "Tritium"}
                </span>
                <button
                    type="button"
                    onClick={() => tritiumRef.current?.shutdown()}
                    aria-label="Close editor"
                    className="ml-4 flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-100"
                >
                    <X className="h-4 w-4" />
                </button>
            </header>
            <div className="relative min-h-0 flex-1">
                <canvas id="tritium-canvas" className="h-full w-full" />
                {(error) && (
                    <div className="absolute left-4 top-4 flex max-w-md items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                        <span>{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
