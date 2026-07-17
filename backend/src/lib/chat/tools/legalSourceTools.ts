export const LEGAL_SOURCE_TOOL_NAMES = {
  search: "search_legal_sources",
  fetch: "fetch_legal_source",
  find: "find_in_legal_source",
  verify: "verify_legal_citations",
} as const;

export const LEGAL_SOURCE_TOOLS = [
  {
    type: "function",
    function: {
      name: LEGAL_SOURCE_TOOL_NAMES.search,
      description:
        "Search an enabled legal-source provider. Returns metadata only; fetch and find an exact passage before citing an authority.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          jurisdiction: { type: "string", enum: ["CA-ON", "CA", "US"] },
          material_type: {
            type: "string",
            enum: ["decision", "legislation", "regulation", "rule"],
          },
          provider_id: { type: "string" },
          court: { type: "string" },
          language: { type: "string", enum: ["en", "fr"] },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query", "jurisdiction", "material_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LEGAL_SOURCE_TOOL_NAMES.fetch,
      description:
        "Fetch authoritative metadata for one search result. This does not by itself verify a proposition; use find_in_legal_source for the exact passage.",
      parameters: {
        type: "object",
        properties: {
          provider_id: { type: "string" },
          source_id: { type: "string" },
          material_type: {
            type: "string",
            enum: ["decision", "legislation", "regulation", "rule"],
          },
          language: { type: "string", enum: ["en", "fr"] },
          section: { type: "string" },
          version_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["provider_id", "source_id", "material_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LEGAL_SOURCE_TOOL_NAMES.find,
      description:
        "Retrieve exact matching passages from a decision, statute, regulation, or rule. Use the returned passage URL and verification state when citing.",
      parameters: {
        type: "object",
        properties: {
          provider_id: { type: "string" },
          source_id: { type: "string" },
          material_type: {
            type: "string",
            enum: ["decision", "legislation", "regulation", "rule"],
          },
          query: { type: "string" },
          section: { type: "string" },
          language: { type: "string", enum: ["en", "fr"] },
          max_results: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["provider_id", "source_id", "material_type", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LEGAL_SOURCE_TOOL_NAMES.verify,
      description:
        "Parse and verify Canadian citations through enabled authorized providers. Citation, passage, currency, and treatment status remain separate.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
];

export type LegalSourceToolEvent =
  | {
      type: "legal_source_search";
      provider_id: string | null;
      provider_name: string | null;
      query: string;
      result_count: number;
      coverage_warning?: string;
      error?: string;
    }
  | {
      type: "legal_authority";
      action: "fetched" | "passages" | "verified";
      provider_id: string | null;
      provider_name: string | null;
      authority?: Record<string, unknown>;
      passage_count?: number;
      error?: string;
    };
