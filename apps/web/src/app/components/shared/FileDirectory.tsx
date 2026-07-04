"use client";

import { useState } from "react";
import {
    Check,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    Trash2,
    Loader2,
} from "lucide-react";
import type { Document, Project } from "./types";
import { VersionChip } from "./VersionChip";
import { FileTypeIcon } from "./FileTypeIcon";
import { SearchBar } from "@/components/ui/search-bar";

function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export function DocFileIcon({ fileType }: { fileType: string | null }) {
    return <FileTypeIcon fileType={fileType} className="h-3.5 w-3.5" />;
}

interface FileDirectoryProps {
    standaloneDocs: Document[];
    directoryProjects: Project[];
    loading: boolean;
    selectedIds: Set<string>;
    onChange: (ids: Set<string>) => void;
    allowMultiple?: boolean;
    forceExpanded?: boolean;
    emptyMessage?: string;
    heading?: string;
    onDelete?: (ids: string[]) => void | Promise<void>;
    uploadingFilenames?: string[];
    searchable?: boolean;
    searchPlaceholder?: string;
    searchAutoFocus?: boolean;
    searchNoResultsMessage?: string;
}

export function FileDirectory({
    standaloneDocs,
    directoryProjects,
    loading,
    selectedIds,
    onChange,
    allowMultiple = true,
    forceExpanded = false,
    emptyMessage = "No documents yet",
    heading = "Documents",
    onDelete,
    uploadingFilenames = [],
    searchable = false,
    searchPlaceholder = "Search...",
    searchAutoFocus = false,
    searchNoResultsMessage = "No matches found",
}: FileDirectoryProps) {
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
        new Set(),
    );
    const [deleting, setDeleting] = useState(false);
    const [search, setSearch] = useState("");

    const selectedCount = selectedIds.size;
    const q = search.trim().toLowerCase();
    const visibleStandaloneDocs = q
        ? standaloneDocs.filter((doc) => doc.filename.toLowerCase().includes(q))
        : standaloneDocs;
    const visibleUploadingFilenames = q
        ? uploadingFilenames.filter((filename) =>
              filename.toLowerCase().includes(q),
          )
        : uploadingFilenames;
    const visibleDirectoryProjects = q
        ? directoryProjects
              .map((project) => {
                  const docs = project.documents ?? [];
                  const projectMatches =
                      project.name.toLowerCase().includes(q) ||
                      (project.cm_number ?? "").toLowerCase().includes(q);
                  return {
                      ...project,
                      documents: projectMatches
                          ? docs
                          : docs.filter((doc) =>
                                doc.filename.toLowerCase().includes(q),
                            ),
                  };
              })
              .filter((project) => {
                  const docs = project.documents ?? [];
                  return (
                      docs.length > 0 ||
                      project.name.toLowerCase().includes(q) ||
                      (project.cm_number ?? "").toLowerCase().includes(q)
                  );
              })
        : directoryProjects;

    async function handleDelete() {
        if (!onDelete || selectedCount === 0 || deleting) return;
        const ids = Array.from(selectedIds);
        setDeleting(true);
        try {
            await onDelete(ids);
            const next = new Set(selectedIds);
            ids.forEach((id) => next.delete(id));
            onChange(next);
        } finally {
            setDeleting(false);
        }
    }

    const allDocs = [
        ...standaloneDocs,
        ...directoryProjects.flatMap((p) => p.documents ?? []),
    ];

    const allStandaloneSelected =
        visibleStandaloneDocs.length > 0 &&
        visibleStandaloneDocs.every((d) => selectedIds.has(d.id));

    function toggle(docId: string) {
        if (!allowMultiple) {
            onChange(new Set([docId]));
            return;
        }
        const next = new Set(selectedIds);
        if (next.has(docId)) {
            next.delete(docId);
        } else {
            next.add(docId);
        }
        onChange(next);
    }

    function toggleAll() {
        if (allStandaloneSelected) {
            const next = new Set(selectedIds);
            visibleStandaloneDocs.forEach((d) => next.delete(d.id));
            onChange(next);
        } else {
            const next = new Set(selectedIds);
            visibleStandaloneDocs.forEach((d) => next.add(d.id));
            onChange(next);
        }
    }

    function toggleFolder(projectId: string) {
        if (forceExpanded) return;
        setExpandedProjects((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    }

    if (loading) {
        return (
            <div className="space-y-px">
                {searchable && (
                    <SearchBar
                        value={search}
                        onValueChange={setSearch}
                        placeholder={searchPlaceholder}
                        autoFocus={searchAutoFocus}
                        wrapperClassName="mb-2"
                    />
                )}
                {/* Documents header skeleton */}
                <div className="flex items-center justify-between rounded-md px-2 py-2">
                    <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
                    <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                </div>
                {/* File rows skeleton */}
                <div>
                    {[60, 45, 75, 55, 40].map((w, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-2 rounded-md px-2 py-2"
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
            </div>
        );
    }

    if (
        allDocs.length === 0 &&
        directoryProjects.length === 0 &&
        uploadingFilenames.length === 0
    ) {
        return (
            <div>
                {searchable && (
                    <SearchBar
                        value={search}
                        onValueChange={setSearch}
                        placeholder={searchPlaceholder}
                        autoFocus={searchAutoFocus}
                        wrapperClassName="mb-2"
                    />
                )}
                <p className="text-center text-sm text-gray-400 py-8">
                    {emptyMessage}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-sm">
            {searchable && (
                <SearchBar
                    value={search}
                    onValueChange={setSearch}
                    placeholder={searchPlaceholder}
                    autoFocus={searchAutoFocus}
                />
            )}
            {q &&
            visibleStandaloneDocs.length === 0 &&
            visibleDirectoryProjects.length === 0 &&
            visibleUploadingFilenames.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">
                    {searchNoResultsMessage}
                </p>
            ) : (
                <div>
                    {(visibleStandaloneDocs.length > 0 ||
                        visibleUploadingFilenames.length > 0 ||
                        (onDelete && selectedCount > 0)) && (
                        <div className="flex items-center justify-between px-2 py-2">
                            <p className="text-xs font-medium text-gray-400">
                                {heading}
                            </p>
                            <div className="flex items-center gap-3">
                                {onDelete && selectedCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                        Delete
                                    </button>
                                )}
                                {visibleStandaloneDocs.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={toggleAll}
                                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                        {allStandaloneSelected
                                            ? "Deselect all"
                                            : "Select all"}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {visibleUploadingFilenames.map((filename) => (
                        <div
                            key={`uploading-${filename}`}
                            className="w-full flex items-center gap-2 px-2 py-2 text-xs text-left"
                        >
                            <span className="shrink-0 h-3.5 w-3.5 rounded border border-gray-300" />
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
                            <span className="flex-1 truncate text-gray-400">
                                {filename}
                            </span>
                            <span className="shrink-0 text-gray-300">
                                Uploading
                            </span>
                        </div>
                    ))}
                    {visibleStandaloneDocs.map((doc) => {
                        const selected = selectedIds.has(doc.id);
                        return (
                            <button
                                type="button"
                                key={doc.id}
                                onClick={() => toggle(doc.id)}
                                className={`w-full rounded-md flex items-center gap-2 px-2 py-2 text-xs transition-all text-left  ${
                                    selected
                                        ? "bg-gray-100"
                                        : "hover:bg-gray-100/70"
                                }`}
                            >
                                <span
                                    className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                                        selected
                                            ? "bg-gray-900 border-gray-900"
                                            : "border-gray-300"
                                    }`}
                                >
                                    {selected && (
                                        <Check className="h-2.5 w-2.5 text-white" />
                                    )}
                                </span>
                                <DocFileIcon fileType={doc.file_type} />
                                <span
                                    className={`flex-1 truncate ${
                                        selected
                                            ? "text-gray-900"
                                            : "text-gray-700"
                                    }`}
                                >
                                    {doc.filename}
                                </span>
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

                    {visibleStandaloneDocs.length > 0 &&
                        visibleDirectoryProjects.length > 0 && (
                            <div className="py-2 px-2 mt-2">
                                <p className="text-xs font-medium text-gray-400">
                                    Projects
                                </p>
                            </div>
                        )}

                    {visibleDirectoryProjects.map((project) => {
                        const isExpanded =
                            forceExpanded ||
                            !!q ||
                            expandedProjects.has(project.id);
                        const docs = project.documents ?? [];
                        return (
                            <div key={project.id}>
                                <button
                                    type="button"
                                    onClick={() => toggleFolder(project.id)}
                                    className="w-full rounded-md flex items-center gap-2 px-2 py-2 text-xs transition-all text-left hover:bg-gray-100/70"
                                >
                                    {isExpanded ? (
                                        <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                                    ) : (
                                        <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
                                    )}
                                    {isExpanded ? (
                                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                    ) : (
                                        <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                    )}
                                    <span className="flex-1 truncate font-medium text-gray-700">
                                        {project.name}
                                        {project.cm_number && (
                                            <span className="ml-1 font-normal text-gray-400">
                                                (#{project.cm_number})
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-xs text-gray-400 shrink-0">
                                        {docs.length}
                                    </span>
                                </button>
                                {isExpanded && (
                                    <div>
                                        {docs.length === 0 ? (
                                            <p className="pl-7 py-1 text-xs text-gray-400">
                                                Empty
                                            </p>
                                        ) : (
                                            docs.map((doc) => {
                                                const selected =
                                                    selectedIds.has(doc.id);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={doc.id}
                                                        onClick={() =>
                                                            toggle(doc.id)
                                                        }
                                                        className={`w-full rounded-md flex items-center gap-2 pl-7 pr-2 py-2 text-xs transition-all text-left  ${
                                                            selected
                                                                ? "bg-gray-100"
                                                                : "hover:bg-gray-100/70"
                                                        }`}
                                                    >
                                                        <span
                                                            className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                                                                selected
                                                                    ? "bg-gray-900 border-gray-900"
                                                                    : "border-gray-300"
                                                            }`}
                                                        >
                                                            {selected && (
                                                                <Check className="h-2.5 w-2.5 text-white" />
                                                            )}
                                                        </span>
                                                        <DocFileIcon
                                                            fileType={
                                                                doc.file_type
                                                            }
                                                        />
                                                        <span
                                                            className={`flex-1 truncate min-w-0 ${
                                                                selected
                                                                    ? "text-gray-900"
                                                                    : "text-gray-700"
                                                            }`}
                                                        >
                                                            {doc.filename}
                                                        </span>
                                                        <VersionChip
                                                            n={
                                                                doc.active_version_number ??
                                                                doc.latest_version_number
                                                            }
                                                        />
                                                        {doc.created_at && (
                                                            <span className="shrink-0 text-gray-300">
                                                                {formatDate(
                                                                    doc.created_at,
                                                                )}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
