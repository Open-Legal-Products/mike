import { createHash } from "crypto";
import type { createServerSupabase } from "./supabase";
import { SYSTEM_WORKFLOWS, type SystemWorkflow } from "./systemWorkflows";
import { storageEnabled, uploadFile } from "./storage";
import { contentTypeForDocumentType } from "./documentTypes";

type Db = ReturnType<typeof createServerSupabase>;

export const DEFAULT_WORKFLOW_IDS = [
  "builtin-proofread",
  "builtin-compare-documents",
  "builtin-extract-key-terms",
  "builtin-draft-from-template",
  "builtin-commercial-agreement-tabular-review",
] as const;

const DEFAULT_WORKFLOW_ID_SET = new Set<string>(DEFAULT_WORKFLOW_IDS);

const QUICK_ACTION_DEFAULTS: Record<
  (typeof DEFAULT_WORKFLOW_IDS)[number],
  { prompt: string; documentUpload: boolean; sortOrder: number }
> = {
  "builtin-proofread": {
    prompt:
      "Review the current document for drafting quality, internal consistency, grammar, punctuation, formatting, numbering, defined terms, and cross-reference errors. List each issue with its location, severity, and a specific recommended fix.",
    documentUpload: true,
    sortOrder: 0,
  },
  "builtin-compare-documents": {
    prompt:
      "Compare the current document with the documents I attach. Present the material similarities, differences, risks, and follow-up points in a structured table, citing the relevant location in each document where available.",
    documentUpload: true,
    sortOrder: 1,
  },
  "builtin-extract-key-terms": {
    prompt:
      "Extract the key legal, commercial, and operational terms from the current document. Present them in a concise table with the term, value, location, and notes, and flag material omissions or ambiguities without inventing missing information.",
    documentUpload: true,
    sortOrder: 2,
  },
  "builtin-draft-from-template": {
    prompt:
      "Create a completed draft from the template I attach, using the current document and any additional materials as source context. Preserve the template's formatting and structure, replace placeholders consistently, and ask for any essential missing information.",
    documentUpload: true,
    sortOrder: 3,
  },
  "builtin-commercial-agreement-tabular-review": {
    prompt:
      "Review the commercial agreements I upload and extract the requested terms into the workflow's configured columns. Support every result with the document text, keep entries concise, and mark information that is not found rather than inferring it.",
    documentUpload: true,
    sortOrder: 4,
  },
};

function workflowById(id: string): SystemWorkflow {
  const workflow = SYSTEM_WORKFLOWS.find((item) => item.id === id);
  if (!workflow) throw new Error(`Default workflow '${id}' is missing`);
  return workflow;
}

export function defaultWorkflowPayloads() {
  return DEFAULT_WORKFLOW_IDS.map((id) => {
    const workflow = workflowById(id);
    const action = QUICK_ACTION_DEFAULTS[id];
    return {
      default_key: id.replace(/^builtin-/, ""),
      title: workflow.metadata.title,
      type: workflow.metadata.type,
      prompt_md: workflow.skill_md,
      columns_config: workflow.columns_config,
      language: workflow.metadata.language,
      practice: workflow.metadata.practice,
      jurisdictions: workflow.metadata.jurisdictions,
      quick_action_prompt: action.prompt,
      document_upload: action.documentUpload,
      sort_order: action.sortOrder,
    };
  });
}

export async function ensureDefaultWorkflows(
  userId: string,
  db: Db,
): Promise<number> {
  const { data, error } = await db.rpc("install_missing_default_workflows", {
    p_user_id: userId,
    p_defaults: defaultWorkflowPayloads(),
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export type WorkflowAddonSeed = {
  addon_key: string;
  pack_key: string | null;
  pack_title: string | null;
  pack_description: string | null;
  pack_version: string | null;
  version: string | null;
  title: string;
  description: string | null;
  type: "assistant" | "tabular";
  prompt_md: string | null;
  columns_config: SystemWorkflow["columns_config"];
  contributors: SystemWorkflow["metadata"]["contributors"];
  language: string;
  practice: string | null;
  jurisdictions: string[] | null;
  content_hash: string;
  active: boolean;
  updated_at: string;
};

export function workflowAddonSeeds(): WorkflowAddonSeed[] {
  return SYSTEM_WORKFLOWS.filter(
    (workflow) => !DEFAULT_WORKFLOW_ID_SET.has(workflow.id),
  ).map((workflow) => {
    const payload = {
      addon_key: workflow.id.replace(/^builtin-/, ""),
      pack_key: workflow.pack?.key ?? null,
      pack_title: workflow.pack?.title ?? null,
      pack_description: workflow.pack?.description ?? null,
      pack_version: workflow.pack?.version ?? null,
      version: workflow.metadata.version ?? null,
      title: workflow.metadata.title,
      description: workflow.metadata.description ?? null,
      type: workflow.metadata.type,
      prompt_md: workflow.skill_md,
      columns_config: workflow.columns_config,
      contributors: workflow.metadata.contributors,
      language: workflow.metadata.language,
      practice: workflow.metadata.practice,
      jurisdictions: workflow.metadata.jurisdictions,
    };
    return {
      ...payload,
      content_hash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      active: true,
      updated_at: new Date().toISOString(),
    };
  });
}

export async function syncWorkflowAddonCatalog(db: Db): Promise<void> {
  const seeds = workflowAddonSeeds();
  const { error } = await db
    .from("workflow_addons")
    .upsert(seeds, { onConflict: "addon_key" });
  if (error) throw error;

  const activeKeys = new Set(seeds.map((seed) => seed.addon_key));
  const { data: existing, error: listError } = await db
    .from("workflow_addons")
    .select("id, addon_key")
    .eq("active", true);
  if (listError) throw listError;
  const removedIds = (existing ?? [])
    .filter((row) => !activeKeys.has(row.addon_key))
    .map((row) => row.id);
  if (removedIds.length > 0) {
    const { error: deactivateError } = await db
      .from("workflow_addons")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("id", removedIds);
    if (deactivateError) throw deactivateError;
  }

  if (!storageEnabled) return;
  const { data: addonRows, error: addonRowsError } = await db
    .from("workflow_addons")
    .select("id, addon_key")
    .in(
      "addon_key",
      seeds.map((seed) => seed.addon_key),
    );
  if (addonRowsError) throw addonRowsError;
  const addonIdByKey = new Map(
    (addonRows ?? []).map((row) => [row.addon_key, row.id]),
  );

  for (const workflow of SYSTEM_WORKFLOWS) {
    if (DEFAULT_WORKFLOW_ID_SET.has(workflow.id)) continue;
    const addonKey = workflow.id.replace(/^builtin-/, "");
    const addonId = addonIdByKey.get(addonKey);
    if (!addonId) continue;
    const { data: currentReferences, error: currentReferencesError } = await db
      .from("workflow_addon_reference_files")
      .select("id, filename, content_hash")
      .eq("addon_id", addonId);
    if (currentReferencesError) throw currentReferencesError;
    const referenceFiles =
      workflow.metadata.type === "assistant" ? workflow.reference_files : [];
    const expectedNames = new Set(referenceFiles.map((file) => file.filename));
    const staleIds = (currentReferences ?? [])
      .filter((file) => !expectedNames.has(file.filename))
      .map((file) => file.id);
    if (staleIds.length > 0) {
      const { error: staleError } = await db
        .from("workflow_addon_reference_files")
        .delete()
        .in("id", staleIds);
      if (staleError) throw staleError;
    }
    const currentHashes = new Map(
      (currentReferences ?? []).map((file) => [
        file.filename,
        file.content_hash,
      ]),
    );
    for (const file of referenceFiles) {
      const bytes = Buffer.from(file.content_base64, "base64");
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (currentHashes.get(file.filename) === contentHash) continue;
      const storagePath = `workflow-addons/${addonKey}/${contentHash}/${file.filename}`;
      await uploadFile(
        storagePath,
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        contentTypeForDocumentType(file.file_type),
      );
      const { error: referenceError } = await db
        .from("workflow_addon_reference_files")
        .upsert(
          {
            addon_id: addonId,
            filename: file.filename,
            file_type: file.file_type,
            storage_path: storagePath,
            size_bytes: file.size_bytes,
            content_hash: contentHash,
          },
          { onConflict: "addon_id,filename" },
        );
      if (referenceError) throw referenceError;
    }
  }
}
