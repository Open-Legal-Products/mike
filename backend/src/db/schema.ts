// Drizzle ORM schema for the Mike backend.
//
// This is a translation of `backend/schema.sql` (the Supabase source of truth)
// targeted at AWS RDS / Aurora Postgres. Compared to the Supabase schema:
//
//   - All RLS (`enable row level security`, `create policy ...`) is removed.
//     Access control is enforced in the Express route handlers (Stage E).
//   - The `handle_new_user` trigger on `auth.users` is removed. User profile
//     rows are upserted by application middleware on first authenticated
//     request once Clerk is wired up (Stage D).
//   - Every `user_id` column that previously referenced `auth.users(id)` is now
//     a plain `text` column with no foreign key. Clerk owns identity; we just
//     store the Clerk user ID (e.g. `user_2abc...`).
//   - `pgcrypto` is still required for `gen_random_uuid()` defaults. The
//     extension is created in the initial drizzle migration prologue.
//
// Keep this schema 1:1 with `backend/schema.sql` for tables/columns/indexes
// that aren't auth- or RLS-related. The legacy `backend/schema.sql` file is
// retained until the upstream merge story is resolved.

import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// User profiles & API keys
// ---------------------------------------------------------------------------

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Clerk user id (text). Previously a uuid FK to auth.users — no longer
    // referenced because Clerk owns identity.
    userId: text("user_id").notNull().unique(),
    displayName: text("display_name"),
    organisation: text("organisation"),
    tier: text("tier").notNull().default("Free"),
    messageCreditsUsed: integer("message_credits_used").notNull().default(0),
    creditsResetDate: timestamp("credits_reset_date", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    tabularModel: text("tabular_model")
      .notNull()
      .default("gemini-3-flash-preview"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_user_profiles_user").on(table.userId),
  }),
);

export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_user_api_keys_user").on(table.userId),
    userProviderUnique: uniqueIndex("user_api_keys_user_provider_key").on(
      table.userId,
      table.provider,
    ),
    providerCheck: check(
      "user_api_keys_provider_check",
      sql`${table.provider} in ('claude', 'gemini', 'openai')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Projects, subfolders, documents
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    cmNumber: text("cm_number"),
    visibility: text("visibility").notNull().default("private"),
    sharedWith: jsonb("shared_with")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_projects_user").on(table.userId),
    sharedWithGin: index("projects_shared_with_idx")
      .using("gin", table.sharedWith),
  }),
);

export const projectSubfolders = pgTable(
  "project_subfolders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    // Self-referencing FK for nested folders.
    parentFolderId: uuid("parent_folder_id").references(
      (): any => projectSubfolders.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    projectIdx: index("idx_project_subfolders_project").on(table.projectId),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    fileType: text("file_type"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    pageCount: integer("page_count"),
    structureTree: jsonb("structure_tree"),
    status: text("status").notNull().default("pending"),
    folderId: uuid("folder_id").references(() => projectSubfolders.id, {
      onDelete: "set null",
    }),
    // Forward reference to documentVersions.id. Declared as a typed column
    // without the FK here, then added in a manual migration step below.
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userProjectIdx: index("idx_documents_user_project").on(
      table.userId,
      table.projectId,
    ),
    projectFolderIdx: index("idx_documents_project_folder").on(
      table.projectId,
      table.folderId,
    ),
  }),
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    pdfStoragePath: text("pdf_storage_path"),
    source: text("source").notNull().default("upload"),
    versionNumber: integer("version_number"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentIdx: index("document_versions_document_id_idx").on(
      table.documentId,
      sql`${table.createdAt} desc`,
    ),
    documentVnumIdx: index("document_versions_doc_vnum_idx").on(
      table.documentId,
      table.versionNumber,
    ),
    sourceCheck: check(
      "document_versions_source_check",
      sql`${table.source} = any (array['upload'::text, 'user_upload'::text, 'assistant_edit'::text, 'user_accept'::text, 'user_reject'::text, 'generated'::text])`,
    ),
  }),
);

export const documentEdits = pgTable(
  "document_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // chat_message_id FK is added after chat_messages is declared, below.
    chatMessageId: uuid("chat_message_id"),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    changeId: text("change_id").notNull(),
    delWId: text("del_w_id"),
    insWId: text("ins_w_id"),
    deletedText: text("deleted_text").notNull().default(""),
    insertedText: text("inserted_text").notNull().default(""),
    contextBefore: text("context_before"),
    contextAfter: text("context_after"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    documentIdx: index("document_edits_document_id_idx").on(
      table.documentId,
      sql`${table.createdAt} desc`,
    ),
    messageIdx: index("document_edits_message_id_idx").on(table.chatMessageId),
    versionIdx: index("document_edits_version_id_idx").on(table.versionId),
    statusCheck: check(
      "document_edits_status_check",
      sql`${table.status} = any (array['pending'::text, 'accepted'::text, 'rejected'::text])`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    title: text("title").notNull(),
    type: text("type").notNull(),
    promptMd: text("prompt_md"),
    columnsConfig: jsonb("columns_config"),
    practice: text("practice"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_workflows_user").on(table.userId),
  }),
);

export const hiddenWorkflows = pgTable(
  "hidden_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_hidden_workflows_user").on(table.userId),
    userWorkflowUnique: uniqueIndex("hidden_workflows_user_workflow_key").on(
      table.userId,
      table.workflowId,
    ),
  }),
);

export const workflowShares = pgTable(
  "workflow_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    sharedByUserId: text("shared_by_user_id").notNull(),
    sharedWithEmail: text("shared_with_email").notNull(),
    allowEdit: boolean("allow_edit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workflowIdx: index("workflow_shares_workflow_id_idx").on(table.workflowId),
    emailIdx: index("workflow_shares_email_idx").on(table.sharedWithEmail),
    workflowEmailUnique: uniqueIndex("workflow_shares_workflow_email_unique").on(
      table.workflowId,
      table.sharedWithEmail,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Assistant chats
// ---------------------------------------------------------------------------

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_chats_user").on(table.userId),
    projectIdx: index("idx_chats_project").on(table.projectId),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content"),
    files: jsonb("files"),
    annotations: jsonb("annotations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatIdx: index("idx_chat_messages_chat").on(table.chatId),
  }),
);

// ---------------------------------------------------------------------------
// Tabular reviews
// ---------------------------------------------------------------------------

export const tabularReviews = pgTable(
  "tabular_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull(),
    title: text("title"),
    columnsConfig: jsonb("columns_config"),
    workflowId: uuid("workflow_id").references(() => workflows.id, {
      onDelete: "set null",
    }),
    practice: text("practice"),
    sharedWith: jsonb("shared_with")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_tabular_reviews_user").on(table.userId),
    projectIdx: index("idx_tabular_reviews_project").on(table.projectId),
    sharedWithGin: index("tabular_reviews_shared_with_idx")
      .using("gin", table.sharedWith),
  }),
);

export const tabularCells = pgTable(
  "tabular_cells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => tabularReviews.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    columnIndex: integer("column_index").notNull(),
    content: text("content"),
    citations: jsonb("citations"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    reviewIdx: index("idx_tabular_cells_review").on(
      table.reviewId,
      table.documentId,
      table.columnIndex,
    ),
  }),
);

export const tabularReviewChats = pgTable(
  "tabular_review_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => tabularReviews.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    reviewIdx: index("tabular_review_chats_review_idx").on(
      table.reviewId,
      sql`${table.updatedAt} desc`,
    ),
    userIdx: index("tabular_review_chats_user_idx").on(table.userId),
  }),
);

export const tabularReviewChatMessages = pgTable(
  "tabular_review_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => tabularReviewChats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content"),
    annotations: jsonb("annotations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatIdx: index("tabular_review_chat_messages_chat_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

export type UserProfile = InferSelectModel<typeof userProfiles>;
export type NewUserProfile = InferInsertModel<typeof userProfiles>;

export type UserApiKey = InferSelectModel<typeof userApiKeys>;
export type NewUserApiKey = InferInsertModel<typeof userApiKeys>;

export type Project = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;

export type ProjectSubfolder = InferSelectModel<typeof projectSubfolders>;
export type NewProjectSubfolder = InferInsertModel<typeof projectSubfolders>;

export type Document = InferSelectModel<typeof documents>;
export type NewDocument = InferInsertModel<typeof documents>;

export type DocumentVersion = InferSelectModel<typeof documentVersions>;
export type NewDocumentVersion = InferInsertModel<typeof documentVersions>;

export type DocumentEdit = InferSelectModel<typeof documentEdits>;
export type NewDocumentEdit = InferInsertModel<typeof documentEdits>;

export type Workflow = InferSelectModel<typeof workflows>;
export type NewWorkflow = InferInsertModel<typeof workflows>;

export type HiddenWorkflow = InferSelectModel<typeof hiddenWorkflows>;
export type NewHiddenWorkflow = InferInsertModel<typeof hiddenWorkflows>;

export type WorkflowShare = InferSelectModel<typeof workflowShares>;
export type NewWorkflowShare = InferInsertModel<typeof workflowShares>;

export type Chat = InferSelectModel<typeof chats>;
export type NewChat = InferInsertModel<typeof chats>;

export type Message = InferSelectModel<typeof chatMessages>;
export type NewMessage = InferInsertModel<typeof chatMessages>;

export type TabularReview = InferSelectModel<typeof tabularReviews>;
export type NewTabularReview = InferInsertModel<typeof tabularReviews>;

export type TabularCell = InferSelectModel<typeof tabularCells>;
export type NewTabularCell = InferInsertModel<typeof tabularCells>;

export type TabularReviewChat = InferSelectModel<typeof tabularReviewChats>;
export type NewTabularReviewChat = InferInsertModel<typeof tabularReviewChats>;

export type TabularReviewChatMessage = InferSelectModel<
  typeof tabularReviewChatMessages
>;
export type NewTabularReviewChatMessage = InferInsertModel<
  typeof tabularReviewChatMessages
>;
