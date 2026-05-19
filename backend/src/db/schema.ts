import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  unique,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// users — mirror of Cognito identities. Populated by ensureUserRow() on the
// first authenticated request. Foreign-key target for user_profiles and
// user_api_keys (previously `auth.users` under Supabase).
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // Cognito sub
  email: text("email").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// user_profiles
// ---------------------------------------------------------------------------

export const user_profiles = pgTable(
  "user_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    display_name: text("display_name"),
    organisation: text("organisation"),
    tier: text("tier").notNull().default("Free"),
    message_credits_used: integer("message_credits_used").notNull().default(0),
    credits_reset_date: timestamp("credits_reset_date", {
      withTimezone: true,
    })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
    tabular_model: text("tabular_model").notNull().default("gemini-3-flash-preview"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_user_profiles_user").on(table.user_id)],
);

// ---------------------------------------------------------------------------
// user_api_keys — Claude removed; server uses Bedrock with IAM creds.
// ---------------------------------------------------------------------------

export const user_api_keys = pgTable(
  "user_api_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encrypted_key: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    auth_tag: text("auth_tag").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("user_api_keys_user_provider_unique").on(table.user_id, table.provider),
    index("idx_user_api_keys_user").on(table.user_id),
    check("user_api_keys_provider_check", sql`${table.provider} in ('gemini', 'openai')`),
  ],
);

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: text("user_id").notNull(),
    name: text("name").notNull(),
    cm_number: text("cm_number"),
    visibility: text("visibility").notNull().default("private"),
    shared_with: jsonb("shared_with")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_projects_user").on(table.user_id),
    index("projects_shared_with_idx").using("gin", table.shared_with),
  ],
);

// ---------------------------------------------------------------------------
// project_subfolders
// ---------------------------------------------------------------------------

export const project_subfolders = pgTable(
  "project_subfolders",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    name: text("name").notNull(),
    parent_folder_id: uuid("parent_folder_id").references(
      (): AnyPgColumn => project_subfolders.id,
      { onDelete: "cascade" },
    ),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_project_subfolders_project").on(table.project_id)],
);

// ---------------------------------------------------------------------------
// documents — note: current_version_id is added below via a circular FK to
// document_versions. drizzle-kit emits this as a deferred ALTER TABLE.
// ---------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    user_id: text("user_id").notNull(),
    filename: text("filename").notNull(),
    file_type: text("file_type"),
    size_bytes: integer("size_bytes").notNull().default(0),
    page_count: integer("page_count"),
    structure_tree: jsonb("structure_tree"),
    status: text("status").notNull().default("pending"),
    folder_id: uuid("folder_id").references(() => project_subfolders.id, {
      onDelete: "set null",
    }),
    current_version_id: uuid("current_version_id").references(
      (): AnyPgColumn => document_versions.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_documents_user_project").on(table.user_id, table.project_id),
    index("idx_documents_project_folder").on(table.project_id, table.folder_id),
  ],
);

// ---------------------------------------------------------------------------
// document_versions
// ---------------------------------------------------------------------------

export const document_versions = pgTable(
  "document_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    document_id: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storage_path: text("storage_path").notNull(),
    pdf_storage_path: text("pdf_storage_path"),
    source: text("source").notNull().default("upload"),
    version_number: integer("version_number"),
    display_name: text("display_name"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_versions_document_id_idx").on(table.document_id, table.created_at.desc()),
    index("document_versions_doc_vnum_idx").on(table.document_id, table.version_number),
    check(
      "document_versions_source_check",
      sql`${table.source} = any (array['upload'::text, 'user_upload'::text, 'assistant_edit'::text, 'user_accept'::text, 'user_reject'::text, 'generated'::text])`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// chat_messages — referenced by document_edits.chat_message_id below.
// ---------------------------------------------------------------------------

export const chats = pgTable(
  "chats",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    user_id: text("user_id").notNull(),
    title: text("title"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chats_user").on(table.user_id),
    index("idx_chats_project").on(table.project_id),
  ],
);

export const chat_messages = pgTable(
  "chat_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    chat_id: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content"),
    files: jsonb("files"),
    annotations: jsonb("annotations"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_chat_messages_chat").on(table.chat_id)],
);

// ---------------------------------------------------------------------------
// document_edits
// ---------------------------------------------------------------------------

export const document_edits = pgTable(
  "document_edits",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    document_id: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chat_message_id: uuid("chat_message_id").references(() => chat_messages.id, {
      onDelete: "set null",
    }),
    version_id: uuid("version_id")
      .notNull()
      .references(() => document_versions.id, { onDelete: "cascade" }),
    change_id: text("change_id").notNull(),
    del_w_id: text("del_w_id"),
    ins_w_id: text("ins_w_id"),
    deleted_text: text("deleted_text").notNull().default(""),
    inserted_text: text("inserted_text").notNull().default(""),
    context_before: text("context_before"),
    context_after: text("context_after"),
    status: text("status").notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("document_edits_document_id_idx").on(table.document_id, table.created_at.desc()),
    index("document_edits_message_id_idx").on(table.chat_message_id),
    index("document_edits_version_id_idx").on(table.version_id),
    check(
      "document_edits_status_check",
      sql`${table.status} = any (array['pending'::text, 'accepted'::text, 'rejected'::text])`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// workflows
// ---------------------------------------------------------------------------

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: text("user_id"),
    title: text("title").notNull(),
    type: text("type").notNull(),
    prompt_md: text("prompt_md"),
    columns_config: jsonb("columns_config"),
    practice: text("practice"),
    is_system: boolean("is_system").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_workflows_user").on(table.user_id)],
);

export const hidden_workflows = pgTable(
  "hidden_workflows",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: text("user_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("hidden_workflows_user_workflow_unique").on(table.user_id, table.workflow_id),
    index("idx_hidden_workflows_user").on(table.user_id),
  ],
);

export const workflow_shares = pgTable(
  "workflow_shares",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workflow_id: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    shared_by_user_id: text("shared_by_user_id").notNull(),
    shared_with_email: text("shared_with_email").notNull(),
    allow_edit: boolean("allow_edit").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workflow_shares_workflow_email_unique").on(table.workflow_id, table.shared_with_email),
    index("workflow_shares_workflow_id_idx").on(table.workflow_id),
    index("workflow_shares_email_idx").on(table.shared_with_email),
  ],
);

// ---------------------------------------------------------------------------
// tabular reviews
// ---------------------------------------------------------------------------

export const tabular_reviews = pgTable(
  "tabular_reviews",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    user_id: text("user_id").notNull(),
    title: text("title"),
    columns_config: jsonb("columns_config"),
    workflow_id: uuid("workflow_id").references(() => workflows.id, {
      onDelete: "set null",
    }),
    practice: text("practice"),
    shared_with: jsonb("shared_with")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_tabular_reviews_user").on(table.user_id),
    index("idx_tabular_reviews_project").on(table.project_id),
    index("tabular_reviews_shared_with_idx").using("gin", table.shared_with),
  ],
);

export const tabular_cells = pgTable(
  "tabular_cells",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    review_id: uuid("review_id")
      .notNull()
      .references(() => tabular_reviews.id, { onDelete: "cascade" }),
    document_id: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    column_index: integer("column_index").notNull(),
    content: text("content"),
    citations: jsonb("citations"),
    status: text("status").notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_tabular_cells_review").on(table.review_id, table.document_id, table.column_index),
  ],
);

export const tabular_review_chats = pgTable(
  "tabular_review_chats",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    review_id: uuid("review_id")
      .notNull()
      .references(() => tabular_reviews.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    title: text("title"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tabular_review_chats_review_idx").on(table.review_id, table.updated_at.desc()),
    index("tabular_review_chats_user_idx").on(table.user_id),
  ],
);

export const tabular_review_chat_messages = pgTable(
  "tabular_review_chat_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    chat_id: uuid("chat_id")
      .notNull()
      .references(() => tabular_review_chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content"),
    annotations: jsonb("annotations"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tabular_review_chat_messages_chat_idx").on(table.chat_id, table.created_at)],
);
