"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
    Check,
    Loader2,
} from "lucide-react";
import type { Document, LibraryFolder } from "./types";
import { FileTypeIcon } from "./FileTypeIcon";
import { ProjectSvgIcon, SubfolderSvgIcon } from "./FolderSvgIcon";
import { SearchBar } from "@/app/components/ui/search-bar";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";
import { SkeletonLine } from "./TablePrimitive";
import { useDirectoryData, type DirectoryTab } from "./useDirectoryData";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";

type DirectoryFolder = Pick<
    LibraryFolder,
    "id" | "name" | "parent_folder_id" | "created_at"
>;

const DIRECTORY_GRID_CLASS =
    "grid grid-cols-[14px_14px_minmax(0,1fr)_48px_84px_64px] items-center gap-2";

const DIRECTORY_TABS: { value: DirectoryTab; label: string }[] = [
    { value: "files", label: "Files" },
    { value: "templates", label: "Templates" },
    { value: "projects", label: "Projects" },
];
const ALL_DIRECTORY_TAB_VALUES = DIRECTORY_TABS.map((tab) => tab.value);

const EMPTY_DOCUMENTS: Document[] = [];
const EMPTY_FOLDERS: LibraryFolder[] = [];

function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function formatBytes(bytes: number | null | undefined) {
    if (bytes == null) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function versionLabel(doc: Document) {
    const n = doc.active_version_number ?? doc.latest_version_number;
    return typeof n === "number" && Number.isFinite(n) && n >= 1
        ? `${n}`
        : null;
}

export function DocFileIcon({ fileType }: { fileType: string | null }) {
    return <FileTypeIcon fileType={fileType} className="h-3.5 w-3.5" />;
}

interface FileDirectoryProps {
    documents?: Document[];
    loading?: boolean;
    selectedDocuments: Document[];
    onChange: (documents: Document[]) => void;
    uploadingFilenames?: string[];
    showTabs: boolean;
    initialTab?: DirectoryTab;
    tabs?: readonly DirectoryTab[];
    excludeProjectId?: string;
    folders?: DirectoryFolder[];
    /** Documents already attached to the target resource. They remain visible
     * and checked, but cannot be toggled again. */
    disabledDocumentIds?: ReadonlySet<string>;
}

export function FileDirectory({
    documents = EMPTY_DOCUMENTS,
    loading: externalLoading = false,
    selectedDocuments,
    onChange,
    uploadingFilenames = [],
    showTabs,
    initialTab = "files",
    tabs = ALL_DIRECTORY_TAB_VALUES,
    excludeProjectId,
    folders = EMPTY_FOLDERS,
    disabledDocumentIds,
}: FileDirectoryProps) {
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
        new Set(),
    );
    const [expandedLibraryFolders, setExpandedLibraryFolders] = useState<
        Set<string>
    >(new Set());
    const initialDirectoryTab = tabs.includes(initialTab)
        ? initialTab
        : (tabs[0] ?? "files");
    const availableTabs = DIRECTORY_TABS.filter((tab) =>
        tabs.includes(tab.value),
    );
    const [selectedTab, setSelectedTab] =
        useState<DirectoryTab>(initialDirectoryTab);

    // Follow initialTab changes so keep-mounted parents (which never remount
    // this component) can still steer the starting tab per open.
    useEffect(() => {
        setSelectedTab(initialDirectoryTab);
    }, [initialDirectoryTab]);
    const [search, setSearch] = useState("");
    const {
        loadingTabs,
        standaloneDocuments,
        templateDocuments,
        fileFolders: loadedFileFolders,
        templateFolders: loadedTemplateFolders,
        projects,
        loadTab,
    } = useDirectoryData(showTabs, initialDirectoryTab);

    useEffect(() => {
        if (
            !showTabs ||
            initialDirectoryTab === "templates" ||
            !tabs.includes("templates")
        )
            return;
        void loadTab("templates");
    }, [initialDirectoryTab, showTabs, loadTab, tabs]);
    const directoryStandaloneDocs = useMemo(
        () =>
            showTabs
                ? [
                      ...documents.filter(
                          (doc) =>
                              !standaloneDocuments.some(
                                  (loadedDoc) => loadedDoc.id === doc.id,
                              ),
                      ),
                      ...standaloneDocuments,
                  ]
                : documents,
        [documents, showTabs, standaloneDocuments],
    );
    const directoryTemplateDocs = showTabs
        ? templateDocuments
        : EMPTY_DOCUMENTS;
    const directoryFileFolders = showTabs
        ? loadedFileFolders
        : folders;
    const directoryTemplateFolders = showTabs
        ? loadedTemplateFolders
        : EMPTY_FOLDERS;
    const localDirectoryProjects = useMemo(
        () =>
            showTabs
                ? projects.filter(
                      (project) => project.id !== excludeProjectId,
                  )
                : [],
        [excludeProjectId, projects, showTabs],
    );
    const selectedIds = useMemo(
        () => new Set(selectedDocuments.map((document) => document.id)),
        [selectedDocuments],
    );
    const checkedIds = useMemo(() => {
        const next = new Set(selectedIds);
        disabledDocumentIds?.forEach((id) => next.add(id));
        return next;
    }, [disabledDocumentIds, selectedIds]);

    const q = search.trim().toLowerCase();
    const visibleStandaloneDocs = q
        ? directoryStandaloneDocs.filter((doc) =>
              doc.filename.toLowerCase().includes(q),
          )
        : directoryStandaloneDocs;
    const visibleUploadingFilenames = q
        ? uploadingFilenames.filter((filename) =>
              filename.toLowerCase().includes(q),
          )
        : uploadingFilenames;
    const visibleTemplateDocs = q
        ? directoryTemplateDocs.filter((doc) =>
              doc.filename.toLowerCase().includes(q),
          )
        : directoryTemplateDocs;
    const visibleDirectoryProjects = q
        ? localDirectoryProjects
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
        : localDirectoryProjects;
    const activeTab = showTabs ? selectedTab : "files";
    const activeLoading = showTabs
        ? !!loadingTabs[activeTab]
        : externalLoading;
    const hasVisibleFiles =
        visibleStandaloneDocs.length > 0 ||
        visibleUploadingFilenames.length > 0;
    const hasVisibleProjects = visibleDirectoryProjects.length > 0;
    const hasVisibleTemplates = visibleTemplateDocs.length > 0;
    const activeTabHasNoResults =
        q &&
        ((activeTab === "files" && !hasVisibleFiles) ||
            (activeTab === "projects" && !hasVisibleProjects) ||
            (activeTab === "templates" && !hasVisibleTemplates));

    function toggle(doc: Document) {
        if (disabledDocumentIds?.has(doc.id)) return;
        const next = new Map(
            selectedDocuments.map((document) => [document.id, document]),
        );
        if (next.has(doc.id)) {
            next.delete(doc.id);
        } else {
            next.set(doc.id, doc);
        }
        onChange([...next.values()]);
    }

    function toggleFolder(projectId: string) {
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

    function toggleDocuments(docs: Document[]) {
        const selectableDocs = docs.filter(
            (doc) => !disabledDocumentIds?.has(doc.id),
        );
        if (selectableDocs.length === 0) return;

        const allSelected = selectableDocs.every((doc) =>
            selectedIds.has(doc.id),
        );
        const next = new Map(
            selectedDocuments.map((document) => [document.id, document]),
        );
        if (allSelected) {
            selectableDocs.forEach((doc) => next.delete(doc.id));
        } else {
            selectableDocs.forEach((doc) => next.set(doc.id, doc));
        }
        onChange([...next.values()]);
    }

    function documentFolderId(doc: Document) {
        return doc.folder_id ?? doc.library_folder_id ?? null;
    }

    function childFolders(
        folders: DirectoryFolder[],
        parentFolderId: string | null,
    ) {
        return folders.filter(
            (folder) => (folder.parent_folder_id ?? null) === parentFolderId,
        );
    }

    function folderDocuments(docs: Document[], folderId: string | null) {
        return docs.filter((doc) => documentFolderId(doc) === folderId);
    }

    function collectFolderDocuments(
        folders: DirectoryFolder[],
        docs: Document[],
        folderId: string,
    ): Document[] {
        const directDocs = folderDocuments(docs, folderId);
        const nestedDocs = childFolders(folders, folderId).flatMap((folder) =>
            collectFolderDocuments(folders, docs, folder.id),
        );
        return [...directDocs, ...nestedDocs];
    }

    function toggleLibraryFolder(folderId: string) {
        setExpandedLibraryFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    }

    function handleTabChange(tab: DirectoryTab) {
        setSelectedTab(tab);
        void loadTab(tab);
    }

    function indentedRowPadding(depth: number) {
        return 8 + Math.max(0, depth) * 22;
    }

    function renderDocumentRow(doc: Document, depth = 0) {
        const selected = checkedIds.has(doc.id);
        const disabled = disabledDocumentIds?.has(doc.id) ?? false;
        return (
            <button
                type="button"
                key={doc.id}
                onClick={() => toggle(doc)}
                disabled={disabled}
                style={{ paddingLeft: indentedRowPadding(depth) }}
                className={`w-full rounded-md ${DIRECTORY_GRID_CLASS} py-2 pr-2 text-xs transition-all text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                        ? APP_SURFACE_ACTIVE_CLASS
                        : APP_SURFACE_HOVER_CLASS
                }`}
            >
                <span
                    className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                        selected
                            ? "bg-gray-900 border-gray-900"
                            : "border-gray-300"
                    }`}
                >
                    {selected && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <DocFileIcon fileType={doc.file_type} />
                <span
                    className={`min-w-0 truncate ${
                        selected ? "text-gray-900" : "text-gray-700"
                    }`}
                >
                    {doc.filename}
                </span>
                <FileDirectoryMetaCells
                    version={versionLabel(doc)}
                    created={formatDate(doc.created_at)}
                    size={formatBytes(doc.size_bytes)}
                />
            </button>
        );
    }

    function renderFolderRows(
        folders: DirectoryFolder[],
        docs: Document[],
        parentFolderId: string | null,
        depth = 0,
    ): ReactNode {
        return childFolders(folders, parentFolderId).map((folder) => {
            const docsInFolder = collectFolderDocuments(folders, docs, folder.id);
            const allSelected =
                docsInFolder.length > 0 &&
                docsInFolder.every((doc) => checkedIds.has(doc.id));
            const someSelected =
                docsInFolder.some((doc) => checkedIds.has(doc.id)) &&
                !allSelected;
            const isExpanded = !!q || expandedLibraryFolders.has(folder.id);
            return (
                <div key={folder.id}>
                    <button
                        type="button"
                        onClick={() => toggleLibraryFolder(folder.id)}
                        style={{ paddingLeft: indentedRowPadding(depth) }}
                        className={`w-full rounded-md ${DIRECTORY_GRID_CLASS} py-2 pr-2 text-xs transition-all text-left ${APP_SURFACE_HOVER_CLASS}`}
                    >
                        <span
                            role="checkbox"
                            aria-checked={someSelected ? "mixed" : allSelected}
                            aria-label={`Select all files in ${folder.name}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleDocuments(docsInFolder);
                            }}
                            className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                                allSelected || someSelected
                                    ? "bg-gray-900 border-gray-900"
                                    : docsInFolder.length === 0
                                      ? "border-gray-200 bg-gray-50"
                                      : "border-gray-300"
                            }`}
                        >
                            {allSelected && (
                                <Check className="h-2.5 w-2.5 text-white" />
                            )}
                            {someSelected && <span className="h-px w-2 bg-white" />}
                        </span>
                        <SubfolderSvgIcon
                            open={isExpanded}
                            className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0 truncate font-medium text-gray-700">
                            {folder.name}
                        </span>
                        <span className="truncate text-gray-400">-</span>
                        <span className="truncate text-gray-400">
                            {formatDate(folder.created_at) ?? "--"}
                        </span>
                        <span className="truncate text-right text-gray-400">
                            {docsInFolder.length}{" "}
                            {docsInFolder.length === 1 ? "file" : "files"}
                        </span>
                    </button>
                    {isExpanded && (
                        <div>
                            {renderFolderRows(
                                folders,
                                docs,
                                folder.id,
                                depth + 1,
                            )}
                            {folderDocuments(docs, folder.id).map((doc) =>
                                renderDocumentRow(doc, depth + 1),
                            )}
                            {docsInFolder.length === 0 && (
                                <p
                                    className="py-1 text-xs text-gray-400"
                                    style={{
                                        paddingLeft:
                                            indentedRowPadding(depth + 1),
                                    }}
                                >
                                    Empty
                                </p>
                            )}
                        </div>
                    )}
                </div>
            );
        });
    }

    if (activeLoading) {
        return (
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
                <SearchBar
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search..."
                    autoFocus
                    wrapperClassName={showTabs ? "mb-4" : "mb-3"}
                />
                {(showTabs || selectedIds.size > 0) && (
                    <FileDirectoryControls
                        activeTab={activeTab}
                        onChange={handleTabChange}
                        selectedCount={selectedIds.size}
                        showTabs={showTabs}
                        tabs={availableTabs}
                    />
                )}
                <div className="flex min-h-0 flex-1 flex-col">
                    <FileDirectoryHeader />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {[60, 45, 75, 55, 40].map((w, i) => (
                            <div
                                key={i}
                                className={`${DIRECTORY_GRID_CLASS} rounded-md px-2 py-2`}
                            >
                                <div className="h-3.5 w-3.5 rounded border border-gray-200 shrink-0" />
                                <div className="h-3.5 w-3.5 rounded bg-gray-100 animate-pulse shrink-0" />
                                <div
                                    className="h-3 rounded bg-gray-100 animate-pulse"
                                    style={{ width: `${w}%` }}
                                />
                                <SkeletonLine className="w-8" />
                                <SkeletonLine className="w-14" />
                                <SkeletonLine className="ml-auto w-10" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (
        !showTabs &&
        directoryStandaloneDocs.length === 0 &&
        uploadingFilenames.length === 0
    ) {
        return (
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
                <SearchBar
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search..."
                    autoFocus
                    wrapperClassName={showTabs ? "mb-4" : "mb-3"}
                />
                {(showTabs || selectedIds.size > 0) && (
                    <FileDirectoryControls
                        activeTab={activeTab}
                        onChange={handleTabChange}
                        selectedCount={selectedIds.size}
                        showTabs={showTabs}
                        tabs={availableTabs}
                    />
                )}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <p className="text-center text-sm text-gray-400 py-8">
                        No documents yet
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col space-y-2 rounded-sm">
            <SearchBar
                value={search}
                onValueChange={setSearch}
                placeholder="Search..."
                autoFocus
                wrapperClassName={showTabs ? "mb-4" : "mb-3"}
            />
            {(showTabs || selectedIds.size > 0) && (
                <FileDirectoryControls
                    activeTab={activeTab}
                    onChange={handleTabChange}
                    selectedCount={selectedIds.size}
                    showTabs={showTabs}
                    tabs={availableTabs}
                />
            )}
            {activeTabHasNoResults ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <p className="text-center text-sm text-gray-400 py-8">
                        No matches found
                    </p>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    <FileDirectoryHeader />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                    {activeTab === "files" && (
                        <>
                            {visibleUploadingFilenames.map((filename) => (
                                <div
                                    key={`uploading-${filename}`}
                                    className={`w-full ${DIRECTORY_GRID_CLASS} py-2 pl-2 pr-2 text-xs text-left`}
                                >
                                    <span className="shrink-0 h-3.5 w-3.5 rounded border border-gray-300" />
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
                                    <span className="flex-1 truncate text-gray-400">
                                        {filename}
                                    </span>
                                    <FileDirectoryMetaCells
                                        version={null}
                                        created="Uploading"
                                        size={null}
                                    />
                                </div>
                            ))}
                            {!q &&
                                renderFolderRows(
                                    directoryFileFolders,
                                    directoryStandaloneDocs,
                                    null,
                                )}
                            {(q
                                ? visibleStandaloneDocs
                                : folderDocuments(directoryStandaloneDocs, null)
                            ).map((doc) => renderDocumentRow(doc))}
                            {!q &&
                                visibleStandaloneDocs.length === 0 &&
                                directoryFileFolders.length === 0 &&
                                visibleUploadingFilenames.length === 0 && (
                                    <p className="text-center text-sm text-gray-400 py-8">
                                        No documents yet
                                    </p>
                                )}
                        </>
                    )}

                    {activeTab === "templates" && (
                        <>
                            {!q &&
                                renderFolderRows(
                                    directoryTemplateFolders,
                                    directoryTemplateDocs,
                                    null,
                                )}
                            {(q
                                ? visibleTemplateDocs
                                : folderDocuments(directoryTemplateDocs, null)
                            ).map((doc) => renderDocumentRow(doc))}
                            {!q &&
                                visibleTemplateDocs.length === 0 &&
                                directoryTemplateFolders.length === 0 && (
                                    <p className="text-center text-sm text-gray-400 py-8">
                                        No templates yet
                                    </p>
                                )}
                        </>
                    )}

                    {activeTab === "projects" &&
                        visibleDirectoryProjects.map((project) => {
                            const isExpanded =
                                !!q || expandedProjects.has(project.id);
                            const docs = project.documents ?? [];
                            const projectFolders = project.folders ?? [];
                            const projectDocIds = docs.map((doc) => doc.id);
                            const allProjectDocsSelected =
                                projectDocIds.length > 0 &&
                                projectDocIds.every((id) =>
                                    checkedIds.has(id),
                                );
                            const someProjectDocsSelected =
                                projectDocIds.some((id) =>
                                    checkedIds.has(id),
                                ) && !allProjectDocsSelected;
                            return (
                                <div key={project.id}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            toggleFolder(project.id)
                                        }
                                        className={`w-full rounded-md ${DIRECTORY_GRID_CLASS} px-2 py-2 text-xs transition-all text-left ${APP_SURFACE_HOVER_CLASS}`}
                                    >
                                        <span
                                            role="checkbox"
                                            aria-checked={
                                                someProjectDocsSelected
                                                    ? "mixed"
                                                    : allProjectDocsSelected
                                            }
                                            aria-label={`Select all files in ${project.name}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleDocuments(docs);
                                            }}
                                            className={`shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center ${
                                                allProjectDocsSelected ||
                                                someProjectDocsSelected
                                                    ? "bg-gray-900 border-gray-900"
                                                    : docs.length === 0
                                                      ? "border-gray-200 bg-gray-50"
                                                      : "border-gray-300"
                                            }`}
                                        >
                                            {allProjectDocsSelected && (
                                                <Check className="h-2.5 w-2.5 text-white" />
                                            )}
                                            {someProjectDocsSelected && (
                                                <span className="h-px w-2 bg-white" />
                                            )}
                                        </span>
                                        <ProjectSvgIcon
                                            open={isExpanded}
                                            className="h-3.5 w-3.5 shrink-0"
                                        />
                                        <span className="min-w-0 truncate font-medium text-gray-700">
                                            {project.name}
                                            {project.cm_number && (
                                                <span className="ml-1 font-normal text-gray-400">
                                                    (#{project.cm_number})
                                                </span>
                                            )}
                                        </span>
                                        <span className="truncate text-gray-400">
                                            -
                                        </span>
                                        <span className="truncate text-gray-400">
                                            {formatDate(project.created_at) ??
                                                "--"}
                                        </span>
                                        <span className="truncate text-right text-gray-400">
                                            {docs.length}{" "}
                                            {docs.length === 1
                                                ? "file"
                                                : "files"}
                                        </span>
                                    </button>
                                    {isExpanded && (
                                        <div>
                                            {docs.length === 0 &&
                                            projectFolders.length === 0 ? (
                                                <p className="pl-7 py-1 text-xs text-gray-400">
                                                    Empty
                                                </p>
                                            ) : (
                                                <>
                                                    {!q &&
                                                        renderFolderRows(
                                                            projectFolders,
                                                            docs,
                                                            null,
                                                            1,
                                                        )}
                                                    {(q
                                                        ? docs
                                                        : folderDocuments(
                                                              docs,
                                                              null,
                                                          )
                                                    ).map((doc) =>
                                                        renderDocumentRow(
                                                            doc,
                                                            1,
                                                        ),
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    {activeTab === "projects" &&
                        !q &&
                        visibleDirectoryProjects.length === 0 && (
                            <p className="text-center text-sm text-gray-400 py-8">
                                No projects yet
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function FileDirectoryHeader() {
    return (
        <div
            className={`${DIRECTORY_GRID_CLASS} px-2 pb-1 pt-0.5 text-[11px] font-medium text-gray-400`}
        >
            <span className="col-span-3">Name</span>
            <span>Version</span>
            <span>Created</span>
            <span className="text-right">Size</span>
        </div>
    );
}

function FileDirectoryMetaCells({
    version,
    created,
    size,
}: {
    version: string | null;
    created: string | null;
    size: string | null;
}) {
    return (
        <>
            <span className="truncate text-gray-400">{version ?? "--"}</span>
            <span className="truncate text-gray-400">{created ?? "--"}</span>
            <span className="truncate text-right text-gray-400">
                {size ?? "--"}
            </span>
        </>
    );
}

function FileDirectoryControls({
    activeTab,
    onChange,
    selectedCount,
    showTabs,
    tabs,
}: {
    activeTab: DirectoryTab;
    onChange: (tab: DirectoryTab) => void;
    selectedCount: number;
    showTabs: boolean;
    tabs: typeof DIRECTORY_TABS;
}) {
    return (
        <div className="flex items-center justify-between gap-3 pr-2">
            {showTabs ? (
                <div className="flex items-center gap-1.5">
                    {tabs.map((tab) => {
                        const active = activeTab === tab.value;
                        return (
                            <TabPillButton
                                key={tab.value}
                                active={active}
                                onClick={() => onChange(tab.value)}
                            >
                                {tab.label}
                            </TabPillButton>
                        );
                    })}
                </div>
            ) : (
                <span />
            )}
            {selectedCount > 0 && (
                <span className="shrink-0 text-xs text-gray-400">
                    {selectedCount} selected
                </span>
            )}
        </div>
    );
}
