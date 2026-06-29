/// <reference types="office-js" />
import React, { useState, useEffect } from "react";
import {
  Button,
  Text,
  Spinner,
  Select,
  Label,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";

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

const BASE_URL: string =
  process.env.REACT_APP_API_BASE_URL ?? "http://localhost:3001";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    height: "100%",
    overflowY: "auto",
  },
  sectionLabel: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
  },
  select: {
    width: "100%",
  },
  actionButton: {
    width: "100%",
  },
  docList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalXS} 0`,
  },
  docItem: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
  },
  spinnerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function ProjectPicker(): React.ReactElement {
  const styles = useStyles();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

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
    setLoadingDocs(true);
    setDocs([]);
    apiClient
      .get<ProjectDoc[]>(`/projects/${selectedProjectId}/documents`)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
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

      // Use raw fetch for multipart — apiClient.post sets Content-Type: application/json
      const token = await OfficeRuntime.storage.getItem("mike_token").catch(
        () => null
      );
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(
        `${BASE_URL}/projects/${selectedProjectId}/documents`,
        {
          method: "POST",
          headers,
          body: formData,
        }
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
      <div className={styles.root}>
        <Spinner label="Loading projects…" />
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className={styles.root}>
        <Text className={styles.errorText}>{projectsError}</Text>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className={styles.root}>
        <Text className={styles.emptyText}>No projects found.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Project selector */}
      <Label className={styles.sectionLabel} htmlFor="project-select">
        Project
      </Label>
      <Select
        id="project-select"
        className={styles.select}
        value={selectedProjectId}
        onChange={(_, d) => {
          setSelectedProjectId(d.value);
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

      {/* Upload button */}
      <Button
        appearance="primary"
        className={styles.actionButton}
        onClick={() => void handleUpload()}
        disabled={uploading || !selectedProjectId}
      >
        {uploading ? "Uploading…" : "Upload current document to project"}
      </Button>

      {uploading && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Uploading…</Text>
        </div>
      )}
      {uploadSuccess && (
        <Text className={styles.successText}>Document uploaded successfully.</Text>
      )}
      {uploadError && (
        <Text className={styles.errorText}>{uploadError}</Text>
      )}

      {/* Document list */}
      <Text className={styles.sectionLabel}>Documents in project</Text>
      {loadingDocs ? (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Loading…</Text>
        </div>
      ) : docs.length === 0 ? (
        <Text className={styles.emptyText}>No documents yet.</Text>
      ) : (
        <div className={styles.docList}>
          {docs.map((doc) => (
            <div key={doc.id} className={styles.docItem}>
              <Text>{doc.filename}</Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
