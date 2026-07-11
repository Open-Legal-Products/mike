import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "migrations",
  "20260710_01_rls_all_tables.sql",
);
const migrationSql = readFileSync(migrationPath, "utf-8");

/** Case-insensitive version for substring checks */
const sql = migrationSql.toLowerCase();

/**
 * The 15 tables that previously had NO row-level security.
 * The migration must enable RLS on each of them.
 */
const TABLES_WITH_RLS = [
  "user_profiles",
  "projects",
  "project_subfolders",
  "documents",
  "document_versions",
  "document_edits",
  "workflows",
  "hidden_workflows",
  "workflow_shares",
  "chats",
  "chat_messages",
  "tabular_reviews",
  "tabular_cells",
  "tabular_review_chats",
  "tabular_review_chat_messages",
] as const;

/**
 * Key tables that are expected to have all four CRUD policies.
 */
const KEY_TABLES_FULL_CRUD = [
  "user_profiles",
  "projects",
  "documents",
  "chats",
  "tabular_reviews",
] as const;

/**
 * Child tables whose SELECT policy should reference a parent table
 * via an EXISTS subquery (no direct user_id column).
 */
const CHILD_TABLES_WITH_EXISTS: Array<{
  table: string;
  parent: string;
}> = [
  { table: "document_versions", parent: "documents" },
  { table: "document_edits", parent: "documents" },
  { table: "chat_messages", parent: "chats" },
  { table: "tabular_cells", parent: "tabular_reviews" },
  { table: "tabular_review_chat_messages", parent: "tabular_review_chats" },
];

describe("RLS migration: 20260710_01_rls_all_tables.sql", () => {
  // -----------------------------------------------------------------------
  // RLS enablement
  // -----------------------------------------------------------------------

  it("should enable row level security on all 15 previously-unprotected tables", () => {
    for (const table of TABLES_WITH_RLS) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("should contain exactly 15 ALTER TABLE ... ENABLE ROW LEVEL SECURITY statements", () => {
    const rlsStatements = migrationSql.match(
      /alter\s+table\s+public\.\w+\s+enable\s+row\s+level\s+security/gi,
    );
    expect(rlsStatements).not.toBeNull();
    expect(rlsStatements!.length).toBe(TABLES_WITH_RLS.length);
  });

  // -----------------------------------------------------------------------
  // CRUD policies on key tables
  // -----------------------------------------------------------------------

  it("should create SELECT, INSERT, UPDATE, and DELETE policies for key tables", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      for (const op of ["select", "insert", "update", "delete"] as const) {
        const policyName = `${table}_${op}`;
        expect(sql).toContain(`create policy ${policyName} on public.${table}`);
      }
    }
  });

  it("should create policies for all 15 tables with RLS enabled", () => {
    for (const table of TABLES_WITH_RLS) {
      // tabular_review_chat_messages uses a shortened prefix (tr_chat_messages)
      const policyPrefix =
        table === "tabular_review_chat_messages"
          ? "tr_chat_messages"
          : table;

      // Every table should have at least a SELECT policy
      expect(sql).toContain(
        `create policy ${policyPrefix}_select on public.${table}`,
      );
    }
  });

  // -----------------------------------------------------------------------
  // Policy naming convention  {table}_{operation}
  // -----------------------------------------------------------------------

  it("policy names should follow the {table}_{operation} pattern for key tables", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      for (const op of ["select", "insert", "update", "delete"] as const) {
        const expected = `${table}_${op}`;
        // Verify the policy name appears in a CREATE POLICY statement
        const regex = new RegExp(
          `create\\s+policy\\s+${expected}\\s+on\\s+public\\.${table}`,
          "i",
        );
        expect(regex.test(migrationSql)).toBe(true);
      }
    }
  });

  it("policy names should follow the {table}_{operation} pattern for all RLS tables", () => {
    for (const table of TABLES_WITH_RLS) {
      // tabular_review_chat_messages uses a shortened prefix (tr_chat_messages)
      const policyPrefix =
        table === "tabular_review_chat_messages"
          ? "tr_chat_messages"
          : table;

      // Every table should have a select policy matching the naming pattern
      const regex = new RegExp(
        `create\\s+policy\\s+${policyPrefix}_select\\s+on\\s+public\\.${table}`,
        "i",
      );
      expect(regex.test(migrationSql)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Child tables reference parent via EXISTS subqueries
  // -----------------------------------------------------------------------

  it("child table SELECT policies should reference parent tables via EXISTS subqueries", () => {
    for (const { table, parent } of CHILD_TABLES_WITH_EXISTS) {
      // Find the SELECT policy for this child table
      const policyPrefix =
        table === "tabular_review_chat_messages"
          ? "tr_chat_messages"
          : table;

      const selectPolicyRegex = new RegExp(
        `create\\s+policy\\s+${policyPrefix}_select[\\s\\S]*?using[\\s\\S]*?exists[\\s\\S]*?from\\s+public\\.${parent}`,
        "i",
      );
      expect(
        selectPolicyRegex.test(migrationSql),
        `Expected ${table}_select policy to contain EXISTS subquery referencing ${parent}`,
      ).toBe(true);
    }
  });

  it("document_versions policies should reference documents table via EXISTS", () => {
    // The SELECT policy should check via documents
    expect(sql).toContain("create policy document_versions_select");
    expect(sql).toMatch(
      /document_versions_select[\s\S]*?exists[\s\S]*?from\s+public\.documents/i,
    );
  });

  it("chat_messages policies should reference chats table via EXISTS", () => {
    expect(sql).toContain("create policy chat_messages_select");
    expect(sql).toMatch(
      /chat_messages_select[\s\S]*?exists[\s\S]*?from\s+public\.chats/i,
    );
  });

  it("tabular_cells policies should reference tabular_reviews table via EXISTS", () => {
    expect(sql).toContain("create policy tabular_cells_select");
    expect(sql).toMatch(
      /tabular_cells_select[\s\S]*?exists[\s\S]*?from\s+public\.tabular_reviews/i,
    );
  });

  // -----------------------------------------------------------------------
  // Shared project access in policies
  // -----------------------------------------------------------------------

  it("projects SELECT policy should check shared_with for project access", () => {
    expect(sql).toContain("create policy projects_select");
    expect(sql).toMatch(/projects_select[\s\S]*?shared_with/i);
  });

  it("documents SELECT policy should check project access via EXISTS subquery", () => {
    expect(sql).toContain("create policy documents_select");
    expect(sql).toMatch(
      /documents_select[\s\S]*?exists[\s\S]*?from\s+public\.projects/i,
    );
  });

  // -----------------------------------------------------------------------
  // Policy operations (FOR clause)
  // -----------------------------------------------------------------------

  it("SELECT policies should use FOR SELECT", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      expect(sql).toMatch(
        new RegExp(`create\\s+policy\\s+${table}_select[\\s\\S]*?for\\s+select`, "i"),
      );
    }
  });

  it("INSERT policies should use FOR INSERT with WITH CHECK", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+policy\\s+${table}_insert[\\s\\S]*?for\\s+insert[\\s\\S]*?with\\s+check`,
          "i",
        ),
      );
    }
  });

  it("UPDATE policies should use FOR UPDATE with USING and WITH CHECK", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+policy\\s+${table}_update[\\s\\S]*?for\\s+update[\\s\\S]*?using[\\s\\S]*?with\\s+check`,
          "i",
        ),
      );
    }
  });

  it("DELETE policies should use FOR DELETE with USING", () => {
    for (const table of KEY_TABLES_FULL_CRUD) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+policy\\s+${table}_delete[\\s\\S]*?for\\s+delete[\\s\\S]*?using`,
          "i",
        ),
      );
    }
  });

  // -----------------------------------------------------------------------
  // Policies target the authenticated role
  // -----------------------------------------------------------------------

  it("all policies should target the authenticated role", () => {
    const createPolicyCount = migrationSql.match(
      /create\s+policy\s+\w+\s+on\s+public\.\w+/gi,
    );
    expect(createPolicyCount).not.toBeNull();
    const totalPolicies = createPolicyCount!.length;

    const authenticatedCount = migrationSql.match(
      /to\s+authenticated/gi,
    );
    expect(authenticatedCount).not.toBeNull();
    expect(authenticatedCount!.length).toBe(totalPolicies);
  });

  // -----------------------------------------------------------------------
  // Additional tables (already had RLS, now have policies)
  // -----------------------------------------------------------------------

  it("should also create policies for user_api_keys table", () => {
    expect(sql).toContain("create policy user_api_keys_select");
    expect(sql).toContain("create policy user_api_keys_insert");
    expect(sql).toContain("create policy user_api_keys_update");
    expect(sql).toContain("create policy user_api_keys_delete");
  });

  it("should create policies for user_mcp_connectors and related tables", () => {
    expect(sql).toContain("create policy user_mcp_connectors_select");
    expect(sql).toContain(
      "create policy user_mcp_oauth_tokens_select",
    );
    // user_mcp_oauth_tokens references user_mcp_connectors via EXISTS
    expect(sql).toMatch(
      /user_mcp_oauth_tokens_select[\s\S]*?exists[\s\S]*?from\s+public\.user_mcp_connectors/i,
    );
  });
});
