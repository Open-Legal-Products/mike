/** API contracts used by the Word task pane. */

export interface LibraryFolder {
  id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  cm_number: string | null;
  created_at: string;
  document_count?: number;
}

export interface Document {
  id: string;
  folder_id?: string | null;
  library_folder_id?: string | null;
  filename: string;
  file_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
}

export interface Chat {
  id: string;
  project_id: string | null;
  user_id: string;
  title: string | null;
  created_at: string;
}

/** A document read the model completed during an assistant turn. */
export interface DocumentReadActivity {
  filename: string;
  /** Stable for stored documents; absent for the request-scoped active document. */
  documentId?: string;
  status: "reading" | "read";
}

export type WordThinkingEvent = {
  type: "thinking";
  isStreaming?: boolean;
};

export type WordReasoningEvent = {
  type: "reasoning";
  text: string;
  isStreaming?: boolean;
};

export type WordContentEvent = {
  type: "content";
  text: string;
  isStreaming?: boolean;
};

export type WordDocumentReadEvent = {
  type: "doc_read";
  filename: string;
  documentId?: string;
  status: DocumentReadActivity["status"];
};

export type WordErrorEvent = { type: "error"; message: string };

/**
 * A backend-persisted assistant activity the Word surface does not render yet.
 *
 * The web assistant stores its event array directly in the message `content`
 * column. Keep the same JSON object here instead of discarding activity types
 * the smaller Word renderer does not understand. Rendering remains explicitly
 * allow-listed through the guards in `lib/wordChatEvents.ts`.
 */
export interface WordAssistantStoredEvent {
  type: string;
  [field: string]: unknown;
}

/** Durable and live assistant events, retained in their original order. */
export type WordAssistantEvent =
  | WordThinkingEvent
  | WordReasoningEvent
  | WordContentEvent
  | WordDocumentReadEvent
  | WordErrorEvent
  | WordAssistantStoredEvent;

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
  /**
   * Assistant turns only. Persisted messages contain completed (`read`) rows;
   * the live panel may temporarily use `reading` while the tool is running.
   */
  docReads?: DocumentReadActivity[];
  /**
   * Preserves frontend-style event chronology for new Word chats. `content`
   * and `docReads` remain as the backward-compatible storage projection.
   */
  events?: WordAssistantEvent[];
}

export interface Workflow {
  id: string;
  metadata: {
    title: string;
    type: "assistant" | "tabular";
    language: string | null;
    practice: string | null;
    jurisdictions: string[] | null;
  };
  skill_md: string | null;
  is_system: boolean;
  allow_edit?: boolean;
}
