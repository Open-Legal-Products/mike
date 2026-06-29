/// <reference types="office-js" />
import React, { useState, useEffect } from "react";
import { FolderOpen, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";
import { Button } from "@mike/shared/ui/button";
import { Label } from "@mike/shared/ui/label";
import { Spinner } from "@mike/shared/ui/spinner";
import { Select } from "@mike/shared/ui/select";

interface Project {
  id: string;
  name: string;
}

// Documents from GET /projects/:id/documents expose `filename` (not `name`).
interface ProjectDoc {
  id: string;
  filename: string;
  created_at?: string;
}

export function ProjectPicker(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const { getDocxBlob } = useWordDoc();

  // Load project list on mount
  useEffect(() => {
    apiClient
      .get<Project[]>("/projects")
      .then((data) => {
        setProjects(data);
        if (data.length > 0) setSelectedProjectId(data[0].id);
      })
      .catch((e: unknown) => {
        setProjectsError(
          e instanceof Error ? e.message : "Failed to load projects"
        );
      })
      .finally(() => setLoadingProjects(false));
  }, []);

  // Reload document list when selected project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setDocs([]);
      return;
    }
    // `ignore` discards a slow response after the selection changed again (or
    // the component unmounted), so a stale project's docs can't overwrite the
    // current ones (request race).
    let ignore = false;
    setLoadingDocs(true);
    setDocsError(null);
    setDocs([]);
    apiClient
      .get<ProjectDoc[]>(`/projects/${selectedProjectId}/documents`)
      .then((d) => {
        if (!ignore) setDocs(d);
      })
      .catch((e: unknown) => {
        // Surface the failure instead of masking a 500 as the "no documents"
        // empty state.
        if (!ignore)
          setDocsError(
            e instanceof Error ? e.message : "Failed to load documents"
          );
      })
      .finally(() => {
        if (!ignore) setLoadingDocs(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedProjectId]);

  const handleUpload = async (): Promise<void> => {
    if (!selectedProjectId) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);

    try {
      // Retrieve the real binary .docx (ZIP archive) rather than raw XML
      const blob = await getDocxBlob();

      // Derive a filename from the document URL or fall back to a default.
      // getFileAsync(Compressed) always returns OOXML (.docx) bytes regardless
      // of the on-disk format, so the upload must carry a .docx extension — the
      // API validates extension against magic bytes and rejects e.g. a ZIP sent
      // as ".doc". Strip any query string and force the .docx extension.
      const rawUrl = Office.context.document.url ?? "";
      const base =
        rawUrl
          .split(/[\\/]/)
          .pop()
          ?.split("?")[0]
          ?.replace(/\.[^.]+$/, "")
          ?.trim() || "document";
      const fileName = `${base}.docx`;

      const formData = new FormData();
      formData.append("file", blob, fileName);

      // Multipart upload: go through the shared auth-aware fetch (so an expired
      // token is refreshed) but let the browser set the multipart Content-Type
      // + boundary, hence includeContentType=false.
      const res = await apiClient.fetch(
        `/projects/${selectedProjectId}/documents`,
        {
          method: "POST",
          body: formData,
        },
        false
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload failed (${res.status}): ${text}`);
      }

      setUploadSuccess(true);

      // Refresh document list
      const updated = await apiClient.get<ProjectDoc[]>(
        `/projects/${selectedProjectId}/documents`
      );
      setDocs(updated);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  if (loadingProjects) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner label="Loading projects…" />
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <AlertCircle className="size-7 text-destructive" />
        <p className="text-sm text-destructive">{projectsError}</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FolderOpen className="size-6" />
        </div>
        <p className="text-sm font-medium text-foreground">No projects found.</p>
        <p className="text-xs text-muted-foreground">
          Create a project in the Mike web app to upload documents to it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 @sm:p-4">
      {/* Project selector */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-select">Project</Label>
        <Select
          id="project-select"
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setUploadSuccess(false);
            setUploadError(null);
          }}
          disabled={uploading}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Upload */}
      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          onClick={() => void handleUpload()}
          disabled={uploading || !selectedProjectId}
        >
          {uploading ? "Uploading…" : "Upload current document to project"}
        </Button>
        {uploading && <Spinner label="Uploading…" />}
        {uploadSuccess && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-green-600">
            <CheckCircle2 className="size-4" />
            Document uploaded successfully.
          </p>
        )}
        {uploadError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {uploadError}
          </p>
        )}
      </div>

      {/* Document list */}
      <div className="flex flex-col gap-2">
        <Label>Documents in project</Label>
        {loadingDocs ? (
          <Spinner label="Loading…" />
        ) : docsError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {docsError}
          </p>
        ) : docs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No documents yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs text-foreground"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.filename}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
