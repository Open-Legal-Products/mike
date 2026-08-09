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

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
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
