// Shared types used across the chat-tools modules. Centralized here so the
// focused modules (editDocument, docRead, caseLaw, runToolCalls, stream)
// can reference them without importing each other and forming cycles.

export type EditAnnotation = {
  kind: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before: string;
  context_after: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
};

export type DocEditedResult = {
  filename: string;
  document_id: string;
  version_id: string;
  version_number: number | null;
  download_url: string;
  annotations: EditAnnotation[];
};

export type TurnEditState = Map<
  string,
  { versionId: string; versionNumber: number; storagePath: string }
>;

export type DocCreatedResult = {
  filename: string;
  download_url: string;
  document_id?: string;
  version_id?: string;
  version_number?: number | null;
};

export type DocReplicatedResult = {
  /** Filename of the source document being copied. */
  filename: string;
  /** How many copies were produced in this single tool call. */
  count: number;
  /** One entry per new copy. */
  copies: {
    new_filename: string;
    document_id: string;
    version_id: string;
  }[];
};

export type CourtlistenerCaseRecord = {
  clusterId: number;
  caseName: string | null;
  citations: string[];
  url: string | null;
  pdfUrl: string | null;
  dateFiled: string | null;
  opinions?: unknown[];
};

export type CourtlistenerTurnState = {
  casesByClusterId: Map<number, CourtlistenerCaseRecord>;
};
