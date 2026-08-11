"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import type { WorkflowReferenceDocument } from "../shared/types";
import {
  deleteWorkflowReferenceFile,
  getWorkflowReferenceUrl,
  listWorkflowReferenceFiles,
  replaceWorkflowReferenceFile,
  uploadWorkflowReferenceFile,
} from "@/app/lib/mikeApi";
import { PillButton } from "../ui/pill-button";

export function WorkflowReferenceFiles({
  workflowId,
  readOnly,
}: {
  workflowId: string;
  readOnly: boolean;
}) {
  const [files, setFiles] = useState<WorkflowReferenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<WorkflowReferenceDocument | null>(null);

  async function reload() {
    try {
      setFiles(await listWorkflowReferenceFiles(workflowId));
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load reference files.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // workflowId is the complete identity for this collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function upload(file: File) {
    setBusyId("upload");
    try {
      const created = await uploadWorkflowReferenceFile(workflowId, file);
      setFiles((current) => [...current, created]);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function replace(file: File) {
    const target = replaceTargetRef.current;
    if (!target) return;
    setBusyId(target.id);
    try {
      await replaceWorkflowReferenceFile(workflowId, target.id, file);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Replacement failed.",
      );
    } finally {
      replaceTargetRef.current = null;
      setBusyId(null);
    }
  }

  async function download(file: WorkflowReferenceDocument) {
    setBusyId(file.id);
    try {
      const resolved = await getWorkflowReferenceUrl(workflowId, file.id);
      const anchor = document.createElement("a");
      anchor.href = resolved.url;
      anchor.download = resolved.filename || file.filename;
      anchor.click();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(file: WorkflowReferenceDocument) {
    setBusyId(file.id);
    try {
      await deleteWorkflowReferenceFile(workflowId, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-4 mb-3 flex min-h-0 flex-1 flex-col rounded-2xl border border-white/70 bg-white/55 px-4 py-3 shadow-sm md:mx-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-gray-800">Reference files</h2>
          <p className="text-xs text-gray-400">
            Available whenever this workflow runs.
          </p>
        </div>
        {!readOnly && (
          <PillButton
            tone="white"
            size="sm"
            disabled={busyId === "upload"}
            onClick={() => uploadInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {busyId === "upload" ? "Uploading…" : "Add file"}
          </PillButton>
        )}
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void replace(file);
        }}
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-2 text-xs text-gray-400">Loading references…</p>
        ) : files.length === 0 ? (
          <p className="py-2 text-xs text-gray-400">No reference files.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-white/70"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                <button
                  type="button"
                  title="Download"
                  onClick={() => void download(file)}
                  disabled={busyId === file.id}
                  className="p-1 text-gray-400 hover:text-gray-700"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        replaceTargetRef.current = file;
                        replaceInputRef.current?.click();
                      }}
                      disabled={busyId === file.id}
                      className="px-1 text-gray-400 hover:text-gray-700"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => void remove(file)}
                      disabled={busyId === file.id}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
