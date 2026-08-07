import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Document, LibraryFolder, Project } from "@mike/core";
import {
  getLibrary,
  listProjectDocuments,
  listProjects,
  uploadStandaloneDocument,
} from "../api/mikeApi";
import {
  partitionSupportedDocumentFiles,
  SUPPORTED_DOCUMENT_ACCEPT,
} from "../lib/documentUpload";
import { Modal } from "./primitives/Modal";
import { Spinner } from "@mike/shared/ui/spinner";
import { TabPillButton } from "@mike/shared/ui/tab-pill-button";
import {
  FileTypeIcon,
  ProjectSvgIcon,
  SubfolderSvgIcon,
} from "./DirectoryIcons";

type DirectoryTab = "files" | "templates" | "projects";

interface AddDocumentsModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (documents: Document[]) => void;
  initialSelectedDocuments?: Document[];
}

const TABS: { value: DirectoryTab; label: string }[] = [
  { value: "files", label: "Files" },
  { value: "templates", label: "Templates" },
  { value: "projects", label: "Projects" },
];

const DIRECTORY_GRID_CLASS =
  "grid grid-cols-[14px_14px_minmax(0,1fr)_64px_48px] items-center gap-1.5";

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AddDocumentsModal({
  open,
  onClose,
  onSelect,
  initialSelectedDocuments = [],
}: AddDocumentsModalProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<DirectoryTab>("files");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDocuments, setProjectDocuments] = useState<
    Record<string, Document[]>
  >({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  );
  const [expandedLibraryFolders, setExpandedLibraryFolders] = useState<
    Set<string>
  >(new Set());
  const [selectedDocuments, setSelectedDocuments] = useState<Document[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [uploadingFilenames, setUploadingFilenames] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialSelectionKey = initialSelectedDocuments
    .map((document) => document.id)
    .join("|");

  useEffect(() => {
    if (!open) return;
    setActiveTab("files");
    setSearch("");
    setWarning(null);
    setError(null);
    setSelectedDocuments(initialSelectedDocuments);
    // The id key deliberately controls reseeding when the parent selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSelectionKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const request =
      activeTab === "projects"
        ? listProjects().then((items) => {
            if (!cancelled) setProjects(items ?? []);
          })
        : getLibrary(activeTab).then((collection) => {
            if (!cancelled) {
              setLibraryFolders(collection.folders ?? []);
              setDocuments(
                [...(collection.documents ?? [])].sort((a, b) =>
                  (b.created_at ?? "").localeCompare(a.created_at ?? "")
                )
              );
            }
          });

    request
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error ? reason.message : "Failed to load documents."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, open]);

  const selectedIds = useMemo(
    () => new Set(selectedDocuments.map((document) => document.id)),
    [selectedDocuments]
  );
  const query = search.trim().toLowerCase();
  const filteredDocuments = query
    ? documents.filter((document) =>
        document.filename.toLowerCase().includes(query)
      )
    : documents;
  const filteredProjects = query
    ? projects.filter((project) =>
        [project.name, project.cm_number ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
    : projects;

  const toggleDocument = (document: Document): void => {
    setSelectedDocuments((current) => {
      if (current.some((item) => item.id === document.id)) {
        return current.filter((item) => item.id !== document.id);
      }
      return [...current, document];
    });
  };

  const toggleProject = async (projectId: string): Promise<void> => {
    if (expandedProjects.has(projectId)) {
      setExpandedProjects((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
      return;
    }

    setExpandedProjects((current) => new Set(current).add(projectId));
    if (projectDocuments[projectId]) return;
    setLoadingProjectId(projectId);
    setError(null);
    try {
      const items = await listProjectDocuments(projectId);
      setProjectDocuments((current) => ({ ...current, [projectId]: items }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to load project documents."
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const { supported, unsupported } = partitionSupportedDocumentFiles(files);
    setWarning(
      unsupported.length === 0
        ? null
        : "Only PDF, Word, Excel, and PowerPoint files can be uploaded."
    );
    if (supported.length === 0) return;

    setUploadingFilenames(supported.map((file) => file.name));
    setError(null);
    const results = await Promise.allSettled(
      supported.map((file) => uploadStandaloneDocument(file))
    );
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    if (uploaded.length > 0) {
      setDocuments((current) => [
        ...uploaded,
        ...current.filter(
          (document) => !uploaded.some((item) => item.id === document.id)
        ),
      ]);
      setSelectedDocuments((current) => [
        ...current,
        ...uploaded.filter(
          (document) => !current.some((item) => item.id === document.id)
        ),
      ]);
      setActiveTab("files");
    }
    if (results.some((result) => result.status === "rejected")) {
      setError(
        uploaded.length > 0
          ? "Some documents could not be uploaded."
          : "Documents could not be uploaded. Please try again."
      );
    }
    setUploadingFilenames([]);
  };

  const documentFolderId = (document: Document): string | null =>
    document.folder_id ?? document.library_folder_id ?? null;

  const childFolders = (
    folders: LibraryFolder[],
    parentId: string | null
  ): LibraryFolder[] =>
    folders.filter(
      (folder) => (folder.parent_folder_id ?? null) === parentId
    );

  const folderDocuments = (
    items: Document[],
    folderId: string | null
  ): Document[] =>
    items.filter((document) => documentFolderId(document) === folderId);

  const collectFolderDocuments = (folderId: string): Document[] => [
    ...folderDocuments(documents, folderId),
    ...childFolders(libraryFolders, folderId).flatMap((folder) =>
      collectFolderDocuments(folder.id)
    ),
  ];

  const toggleLibraryFolder = (folderId: string): void => {
    setExpandedLibraryFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const renderDocument = (document: Document, depth = 0) => {
    const selected = selectedIds.has(document.id);
    return (
      <button
        key={document.id}
        type="button"
        onClick={() => toggleDocument(document)}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={`w-full min-w-0 rounded-md py-2 pr-2 text-left text-xs transition-all ${DIRECTORY_GRID_CLASS} ${
          selected
            ? "bg-white/80 text-gray-900 shadow-[0_2px_6px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
            : "text-gray-700 hover:bg-white/55"
        }`}
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            selected ? "border-gray-900 bg-gray-900" : "border-gray-300"
          }`}
        >
          {selected && <Check className="h-2.5 w-2.5 text-white" />}
        </span>
        <FileTypeIcon fileType={document.file_type ?? document.filename} />
        <span className="min-w-0 truncate">{document.filename}</span>
        <span
          className="truncate text-[10px] text-gray-400"
          title={formatDate(document.created_at) || "--"}
        >
          {formatDate(document.created_at) || "--"}
        </span>
        <span
          className="truncate text-right text-[10px] text-gray-400"
          title={formatBytes(document.size_bytes) || "--"}
        >
          {formatBytes(document.size_bytes) || "--"}
        </span>
      </button>
    );
  };

  function renderFolderRows(
    folders: LibraryFolder[],
    parentId: string | null,
    depth = 0
  ): React.ReactNode {
    return childFolders(folders, parentId).map((folder) => {
      const expanded = expandedLibraryFolders.has(folder.id);
      const items = collectFolderDocuments(folder.id);
      return (
        <div key={folder.id}>
          <button
            type="button"
            onClick={() => toggleLibraryFolder(folder.id)}
            style={{ paddingLeft: 8 + depth * 16 }}
            className={`w-full rounded-md py-2 pr-2 text-left text-xs text-gray-700 transition-all hover:bg-white/55 ${DIRECTORY_GRID_CLASS}`}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
            <SubfolderSvgIcon
              open={expanded}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="min-w-0 truncate font-medium">{folder.name}</span>
            <span
              className="truncate text-[10px] text-gray-400"
              title={formatDate(folder.created_at) || "--"}
            >
              {formatDate(folder.created_at) || "--"}
            </span>
            <span className="truncate text-right text-[10px] text-gray-400">
              {items.length} {items.length === 1 ? "file" : "files"}
            </span>
          </button>
          {expanded && (
            <div>
              {renderFolderRows(folders, folder.id, depth + 1)}
              {folderDocuments(documents, folder.id).map((document) =>
                renderDocument(document, depth + 1)
              )}
              {items.length === 0 && (
                <p
                  className="py-1 text-xs text-gray-400"
                  style={{ paddingLeft: 40 + depth * 16 }}
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Documents"
      secondaryAction={{
        label: uploadingFilenames.length > 0 ? "Uploading…" : "Upload",
        icon:
          uploadingFilenames.length > 0 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          ),
        onClick: () => fileInputRef.current?.click(),
        disabled: uploadingFilenames.length > 0,
      }}
      primaryAction={{
        label: "Confirm",
        disabled:
          selectedDocuments.length === 0 || uploadingFilenames.length > 0,
        onClick: () => {
          onSelect(selectedDocuments);
          onClose();
        },
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_DOCUMENT_ACCEPT}
        multiple
        className="hidden"
        aria-label="Upload documents"
        onChange={(event) => void handleUpload(event)}
      />

      {(warning || error) && (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-gray-900"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
          <span className="min-w-0 flex-1">{warning ?? error}</span>
          <button
            type="button"
            onClick={() => {
              setWarning(null);
              setError(null);
            }}
            className="shrink-0 rounded p-0.5 text-gray-600 hover:bg-gray-100"
            aria-label="Dismiss warning"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <label className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 text-gray-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_7px_rgba(15,23,42,0.05)]">
        <Search className="h-3.5 w-3.5" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search..."
          autoFocus
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400"
        />
      </label>

      <div className="my-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <TabPillButton
              key={tab.value}
              active={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
              className="shrink-0 px-2.5"
            >
              {tab.label}
            </TabPillButton>
          ))}
        </div>
        {selectedDocuments.length > 0 && (
          <span className="shrink-0 text-[11px] text-gray-400">
            {selectedDocuments.length} selected
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`shrink-0 px-2 pb-1 text-[10px] font-medium text-gray-400 ${DIRECTORY_GRID_CLASS}`}
        >
          <span className="col-span-3">Name</span>
          <span>Date</span>
          <span className="text-right">Size</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading documents…" />
            </div>
          ) : activeTab === "projects" ? (
            filteredProjects.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                {query ? "No matches found" : "No projects yet"}
              </p>
            ) : (
              <div className="space-y-px">
                {filteredProjects.map((project) => {
                  const expanded = expandedProjects.has(project.id);
                  const items = projectDocuments[project.id] ?? [];
                  return (
                    <div key={project.id}>
                      <button
                        type="button"
                        onClick={() => void toggleProject(project.id)}
                        className={`w-full rounded-md px-2 py-2.5 text-left text-xs text-gray-700 transition-all hover:bg-white/55 ${DIRECTORY_GRID_CLASS}`}
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${
                            expanded ? "rotate-90" : ""
                          }`}
                        />
                        <ProjectSvgIcon
                          open={expanded}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0 truncate font-medium">
                          {project.name}
                          {project.cm_number && (
                            <span className="ml-1 font-normal text-gray-400">
                              #{project.cm_number}
                            </span>
                          )}
                        </span>
                        <span
                          className="truncate text-[10px] text-gray-400"
                          title={formatDate(project.created_at) || "--"}
                        >
                          {formatDate(project.created_at) || "--"}
                        </span>
                        <span className="truncate text-right text-[10px] text-gray-400">
                          {projectDocuments[project.id]?.length ??
                            project.document_count ??
                            0}{" "}
                          files
                        </span>
                      </button>
                      {expanded &&
                        (loadingProjectId === project.id ? (
                          <div className="flex justify-center py-3">
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          </div>
                        ) : items.length > 0 ? (
                          items
                            .filter(
                              (document) =>
                                !query ||
                                document.filename.toLowerCase().includes(query)
                            )
                            .map((document) => renderDocument(document, 1))
                        ) : (
                          <p className="py-2 pl-9 text-xs text-gray-400">
                            No documents
                          </p>
                        ))}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <>
              {activeTab === "files" &&
                uploadingFilenames.map((filename) => (
                  <div
                    key={filename}
                    className={`px-2 py-2 text-xs text-gray-400 ${DIRECTORY_GRID_CLASS}`}
                  >
                    <span className="h-3.5 w-3.5 rounded border border-gray-300" />
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="min-w-0 truncate">{filename}</span>
                    <span className="truncate text-[10px]">Uploading</span>
                    <span className="text-right text-[10px]">--</span>
                  </div>
                ))}
              {query ? (
                filteredDocuments.map((document) => renderDocument(document))
              ) : (
                <>
                  {renderFolderRows(libraryFolders, null)}
                  {folderDocuments(documents, null).map((document) =>
                    renderDocument(document)
                  )}
                </>
              )}
              {filteredDocuments.length === 0 &&
                libraryFolders.length === 0 &&
                uploadingFilenames.length === 0 && (
                  <p className="py-8 text-center text-sm text-gray-400">
                    {query ? "No matches found" : `No ${activeTab} yet`}
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
