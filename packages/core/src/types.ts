// Shared TypeScript types for Mike AI legal assistant

export interface Folder {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  is_owner?: boolean;
  owner_display_name?: string | null;
  owner_email?: string | null;
  name: string;
  cm_number: string | null;
  shared_with: string[];
  created_at: string;
  updated_at: string;
  documents?: Document[];
  folders?: Folder[];
  document_count?: number;
  chat_count?: number;
  review_count?: number;
}

export interface Document {
  id: string;
  user_id?: string;
  project_id: string | null;
  folder_id?: string | null;
  filename: string;
  owner_email?: string | null;
  owner_display_name?: string | null;
  file_type: string | null; // pdf | docx | doc
  storage_path: string | null;
  pdf_storage_path: string | null;
  size_bytes: number | null;
  page_count: number | null;
  structure_tree: StructureNode[] | null;
  status: "pending" | "processing" | "ready" | "error";
  created_at: string | null;
  updated_at?: string | null;
  /** Version number of the document row pointed to by current_version_id. */
  active_version_number?: number | null;
  /** Legacy: max version_number across assistant_edit rows, null if doc is unedited. */
  latest_version_number?: number | null;
}

export interface StructureNode {
  id: string;
  title: string;
  level: number;
  page_number: number | null;
  children: StructureNode[];
}

export interface Chat {
  id: string;
  project_id: string | null;
  user_id: string;
  creator_display_name?: string | null;
  title: string | null;
  created_at: string;
}

export interface EditAnnotation {
  type?: "edit_data";
  kind?: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  /** Per-document monotonic Vn for the edit's target version. */
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before?: string;
  context_after?: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
}

export type AssistantEvent =
  | { type: "reasoning"; text: string; isStreaming?: boolean }
  | { type: "error"; message: string }
  | {
      type: "tool_call_start";
      name: string;
      isStreaming?: boolean;
    }
  | {
      type: "mcp_tool_call";
      connector_id: string;
      connector_name: string;
      tool_name: string;
      openai_tool_name: string;
      status: "ok" | "error";
      error?: string;
      isStreaming?: boolean;
    }
  | { type: "thinking"; isStreaming?: boolean }
  | {
      type: "doc_read";
      filename: string;
      document_id?: string;
      isStreaming?: boolean;
    }
  | {
      type: "doc_find";
      filename: string;
      query: string;
      total_matches: number;
      isStreaming?: boolean;
    }
  | {
      type: "doc_created";
      filename: string;
      download_url: string;
      /** Set when the generated doc is persisted as a first-class document. */
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
      isStreaming?: boolean;
    }
  | { type: "doc_download"; filename: string; download_url: string }
  | {
      type: "doc_replicated";
      /** Source document filename. */
      filename: string;
      /** How many copies were produced in this single tool call. */
      count: number;
      /** One entry per new copy. Empty while streaming. */
      copies?: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    }
  | { type: "workflow_applied"; workflow_id: string; title: string }
  | {
      type: "doc_edited";
      filename: string;
      document_id: string;
      version_id: string;
      /** Per-document monotonic Vn written at emit time. */
      version_number?: number | null;
      download_url: string;
      annotations: EditAnnotation[];
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "courtlistener_search_case_law";
      query: string;
      result_count?: number;
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "courtlistener_get_cases";
      cluster_ids: number[];
      case_count?: number;
      opinion_count?: number;
      cases?: {
        cluster_id: number;
        case_name: string | null;
        citation: string | null;
        dateFiled?: string | null;
        url?: string | null;
      }[];
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "courtlistener_find_in_case";
      cluster_id: number | null;
      query: string;
      total_matches?: number;
      case_name?: string | null;
      citation?: string | null;
      searches?: {
        cluster_id: number | null;
        query: string;
        total_matches?: number;
        case_name?: string | null;
        citation?: string | null;
        error?: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "courtlistener_read_case";
      cluster_id: number | null;
      case_name?: string | null;
      citation?: string | null;
      opinion_count?: number;
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "courtlistener_verify_citations";
      citation_count?: number;
      match_count?: number;
      error?: string;
      isStreaming?: boolean;
    }
  | {
      type: "case_citation";
      cluster_id: number | null;
      case_name: string | null;
      citation: string | null;
      url: string;
      pdfUrl?: string | null;
      dateFiled?: string | null;
      case?: Extract<AssistantEvent, { type: "case_opinions" }>["case"];
    }
  | {
      type: "case_opinions";
      cluster_id: number;
      case: {
        id: number | null;
        caseName?: string | null;
        dateFiled?: string | null;
        citations?: string[];
        url?: string | null;
        pdfUrl?: string | null;
        opinions: {
          opinionId: number | null;
          apiUrl?: string | null;
          type: string | null;
          author: string | null;
          url: string | null;
          text?: string | null;
          html?: string | null;
        }[];
      };
    }
  | { type: "content"; text: string; isStreaming?: boolean };

export type CaseCitationQuote = {
  opinionId: number | null;
  type: string | null;
  author: string | null;
  quote: string;
};

export interface Message {
  role: "user" | "assistant";
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
  model?: string;
  annotations?: CitationAnnotation[];
  citationStatus?: "started" | "partial" | "final";
  events?: AssistantEvent[];
  /** Set when streaming failed; rendered as a red error block. */
  error?: string;
}

export interface CitationQuote {
  page?: number;
  quote: string;
}

export type DocumentCitationQuote = {
  page: number | string;
  quote: string;
};

export type DocumentCitationAnnotation = {
  type: "citation_data";
  kind?: "document";
  ref: number;
  doc_id: string;
  document_id: string;
  version_id?: string | null;
  version_number?: number | null;
  filename: string;
  /** Legacy single-quote fields. Prefer `quotes` for new annotations. */
  page: number | string;
  quote: string;
  quotes?: DocumentCitationQuote[];
};

export type CaseCitationAnnotation = {
  type: "citation_data";
  kind: "case";
  ref: number;
  cluster_id: number;
  case_name?: string | null;
  citation?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
  dateFiled?: string | null;
  quotes: CaseCitationQuote[];
};

/**
 * A citation emitted by the assistant. Document citations have doc/page
 * anchors. Case citations anchor to a CourtListener cluster and include a
 * quoted opinion passage.
 */
export type CitationAnnotation =
  | DocumentCitationAnnotation
  | CaseCitationAnnotation;

const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

function expandDocumentQuoteEntry(entry: DocumentCitationQuote): CitationQuote[] {
  const rangeMatch =
    typeof entry.page === "string"
      ? entry.page.match(/^(\d+)\s*-\s*(\d+)$/)
      : null;
  if (rangeMatch && entry.quote.includes(PAGE_BREAK_SENTINEL)) {
    const startPage = parseInt(rangeMatch[1], 10);
    const endPage = parseInt(rangeMatch[2], 10);
    const [before, after] = entry.quote.split(PAGE_BREAK_SENTINEL);
    return [
      { page: startPage, quote: before.trim() },
      { page: endPage, quote: after.trim() },
    ].filter((e) => e.quote.length > 0);
  }
  const pageNum =
    typeof entry.page === "number"
      ? entry.page
      : parseInt(String(entry.page), 10);
  if (!Number.isFinite(pageNum)) return [];
  return [{ page: pageNum, quote: entry.quote }];
}

export function getDocumentCitationQuotes(
  a: CitationAnnotation,
): DocumentCitationQuote[] {
  if (a.kind === "case") return [];
  if (Array.isArray(a.quotes) && a.quotes.length) {
    return a.quotes.filter((entry) => entry.quote.trim().length > 0);
  }
  return [{ page: a.page, quote: a.quote }];
}

/**
 * Expand a citation into one or more (page, quote) entries suitable for
 * highlighting in the PDF viewer. A single-page citation yields one entry; a
 * cross-page citation with page "N-M" and a `[[PAGE_BREAK]]` split yields two.
 */
export function expandCitationToEntries(
  a: CitationAnnotation,
): CitationQuote[] {
  if (a.kind === "case") return [];
  return getDocumentCitationQuotes(a).flatMap(expandDocumentQuoteEntry);
}

/** Format the page(s) of a citation for display, e.g. "Page 3" or "Page 41-42". */
export function formatCitationPage(a: CitationAnnotation): string {
  if (a.kind === "case") {
    return a.citation || a.case_name || `Case ${a.cluster_id}`;
  }
  const quotes = getDocumentCitationQuotes(a);
  const pages = Array.from(
    new Set(quotes.map((q) => String(q.page)).filter(Boolean)),
  );
  if (pages.length > 1) return `Pages ${pages.join(", ")}`;
  if (pages.length === 1) return `Page ${pages[0]}`;
  if (typeof a.page === "string") return `Page ${a.page}`;
  return `Page ${a.page}`;
}

/** Produce a reader-friendly version of the quote (replaces [[PAGE_BREAK]] with "..."). */
export function displayCitationQuote(a: CitationAnnotation): string {
  if (a.kind === "case") {
    return a.quotes
      .map((q) => q.quote.replaceAll(PAGE_BREAK_SENTINEL, "..."))
      .join(" / ");
  }
  return getDocumentCitationQuotes(a)
    .map((q) => q.quote.replaceAll(PAGE_BREAK_SENTINEL, "..."))
    .join(" / ");
}

// Tabular Review

export type ColumnFormat =
  | "text"
  | "bulleted_list"
  | "number"
  | "currency"
  | "yes_no"
  | "date"
  | "tag"
  | "percentage"
  | "monetary_amount";

export interface ColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: ColumnFormat;
  tags?: string[];
}

export interface TabularReview {
  id: string;
  project_id: string | null;
  user_id: string;
  title: string | null;
  columns_config: ColumnConfig[] | null;
  document_ids?: string[] | null;
  workflow_id: string | null;
  practice?: string | null;
  /** Per-review email list. Used so standalone (project_id null) reviews can be shared directly. */
  shared_with?: string[];
  /** Server-set: true when the requesting user is the review's creator. */
  is_owner?: boolean;
  created_at: string;
  updated_at: string;
  document_count?: number;
}

export interface TabularCell {
  id: string;
  review_id: string;
  document_id: string;
  column_index: number;
  content: {
    summary: string;
    flag?: "green" | "grey" | "yellow" | "red";
    reasoning?: string;
  } | null;
  status: "pending" | "generating" | "done" | "error";
  created_at: string;
}

// Workflows

export interface Workflow {
  id: string;
  user_id: string | null;
  title: string;
  type: "assistant" | "tabular";
  prompt_md: string | null;
  columns_config: ColumnConfig[] | null;
  is_system: boolean;
  created_at: string;
  practice?: string | null;
  shared_by_name?: string | null;
  allow_edit?: boolean;
  is_owner?: boolean;
}

// API helpers

export interface ChatDetailOut {
  chat: Chat;
  messages: Message[];
}

export interface TabularReviewDetailOut {
  review: TabularReview;
  cells: TabularCell[];
  documents: Document[];
}
