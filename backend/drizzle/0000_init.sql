CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text,
	"organisation" text,
	"tier" text DEFAULT 'Free' NOT NULL,
	"message_credits_used" integer DEFAULT 0 NOT NULL,
	"credits_reset_date" timestamp with time zone DEFAULT (now() + interval '30 days') NOT NULL,
	"tabular_model" text DEFAULT 'gemini-3-flash-preview' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_keys_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "user_api_keys_provider_check" CHECK ("user_api_keys"."provider" in ('gemini', 'openai'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"cm_number" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_subfolders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_folder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"structure_tree" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"folder_id" uuid,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"pdf_storage_path" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"version_number" integer,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_source_check" CHECK ("document_versions"."source" = any (array['upload'::text, 'user_upload'::text, 'assistant_edit'::text, 'user_accept'::text, 'user_reject'::text, 'generated'::text]))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb,
	"files" jsonb,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chat_message_id" uuid,
	"version_id" uuid NOT NULL,
	"change_id" text NOT NULL,
	"del_w_id" text,
	"ins_w_id" text,
	"deleted_text" text DEFAULT '' NOT NULL,
	"inserted_text" text DEFAULT '' NOT NULL,
	"context_before" text,
	"context_after" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "document_edits_status_check" CHECK ("document_edits"."status" = any (array['pending'::text, 'accepted'::text, 'rejected'::text]))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"prompt_md" text,
	"columns_config" jsonb,
	"practice" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hidden_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_workflows_user_workflow_unique" UNIQUE("user_id","workflow_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"shared_by_user_id" text NOT NULL,
	"shared_with_email" text NOT NULL,
	"allow_edit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_shares_workflow_email_unique" UNIQUE("workflow_id","shared_with_email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" text NOT NULL,
	"title" text,
	"columns_config" jsonb,
	"workflow_id" uuid,
	"practice" text,
	"shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"column_index" integer NOT NULL,
	"content" text,
	"citations" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_review_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabular_review_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_subfolders" ADD CONSTRAINT "project_subfolders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_subfolders" ADD CONSTRAINT "project_subfolders_parent_folder_id_project_subfolders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "project_subfolders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_project_subfolders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "project_subfolders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edits" ADD CONSTRAINT "document_edits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edits" ADD CONSTRAINT "document_edits_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edits" ADD CONSTRAINT "document_edits_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_shares" ADD CONSTRAINT "workflow_shares_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_reviews" ADD CONSTRAINT "tabular_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_reviews" ADD CONSTRAINT "tabular_reviews_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_cells" ADD CONSTRAINT "tabular_cells_review_id_tabular_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "tabular_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_cells" ADD CONSTRAINT "tabular_cells_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_review_chats" ADD CONSTRAINT "tabular_review_chats_review_id_tabular_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "tabular_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabular_review_chat_messages" ADD CONSTRAINT "tabular_review_chat_messages_chat_id_tabular_review_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "tabular_review_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_profiles_user" ON "user_profiles" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_api_keys_user" ON "user_api_keys" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_user" ON "projects" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_shared_with_idx" ON "projects" USING gin ("shared_with");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_subfolders_project" ON "project_subfolders" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_user_project" ON "documents" ("user_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_project_folder" ON "documents" ("project_id","folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_document_id_idx" ON "document_versions" ("document_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_doc_vnum_idx" ON "document_versions" ("document_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chats_user" ON "chats" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chats_project" ON "chats" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_messages_chat" ON "chat_messages" ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edits_document_id_idx" ON "document_edits" ("document_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edits_message_id_idx" ON "document_edits" ("chat_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_edits_version_id_idx" ON "document_edits" ("version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workflows_user" ON "workflows" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hidden_workflows_user" ON "hidden_workflows" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_shares_workflow_id_idx" ON "workflow_shares" ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_shares_email_idx" ON "workflow_shares" ("shared_with_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tabular_reviews_user" ON "tabular_reviews" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tabular_reviews_project" ON "tabular_reviews" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tabular_reviews_shared_with_idx" ON "tabular_reviews" USING gin ("shared_with");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tabular_cells_review" ON "tabular_cells" ("review_id","document_id","column_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tabular_review_chats_review_idx" ON "tabular_review_chats" ("review_id","updated_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tabular_review_chats_user_idx" ON "tabular_review_chats" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tabular_review_chat_messages_chat_idx" ON "tabular_review_chat_messages" ("chat_id","created_at");
