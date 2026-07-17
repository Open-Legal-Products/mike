import { storageKey, uploadFile, downloadFile } from "../../storage";
import { convertedPdfKey } from "../../convert";
import { type EditInput } from "../../docxTrackedChanges";
import { buildDownloadUrl } from "../../downloadTokens";
import { loadActiveVersion } from "../../documentVersions";
import { logger } from "../../logger";
import { resolveDocLabel } from "../docResolve";
import { generateDocx } from "../docxGenerate";
import { runEditDocument } from "../editDocument";
import { readDocumentContent, findInDocumentContent } from "../docRead";
import {
  getActiveEmbeddingProvider,
  resolveEmbeddingModel,
} from "../../llm/embeddings";
import { searchDocumentChunks } from "../../rag/searchDocuments";
import type { DocEditedResult } from "../types";
import {
  type ToolHandler,
  pushToolResult,
  spotlight,
  citationReminder,
} from "./context";

const readDocument: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, write, nonce } = ctx;
  const rawDocId = args.doc_id as string;
  const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
  const content = await readDocumentContent(docId, docStore, write, docIndex, db);
  const filename = docStore.get(docId)?.filename;
  const documentId = docIndex?.[docId]?.document_id;
  if (filename) ctx.results.docsRead.push({ filename, document_id: documentId });
  // Wrap document content in the spotlight fence: the document body
  // is entirely user-controlled and may contain injected instructions.
  const fencedContent = nonce ? spotlight(content, nonce) : content;
  pushToolResult(
    ctx,
    filename
      ? `${citationReminder(docId, filename)}\n\n${fencedContent}`
      : fencedContent,
  );
};

const findInDocument: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, write } = ctx;
  const rawDocId = args.doc_id as string;
  const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
  const query = (args.query as string) ?? "";
  const maxResults =
    typeof args.max_results === "number" ? args.max_results : undefined;
  const contextChars =
    typeof args.context_chars === "number" ? args.context_chars : undefined;
  const content = await findInDocumentContent({
    docLabel: docId,
    query,
    maxResults,
    contextChars,
    docStore,
    write,
    docIndex,
    db,
  });
  const filename = docStore.get(docId)?.filename;
  if (filename) {
    let totalMatches = 0;
    try {
      const parsed = JSON.parse(content) as {
        total_matches?: number;
      };
      totalMatches = parsed.total_matches ?? 0;
    } catch {
      /* ignore — still record the find attempt */
    }
    ctx.results.docsFound.push({
      filename,
      query,
      total_matches: totalMatches,
    });
  }
  pushToolResult(ctx, content);
};

const listDocuments: ToolHandler = async (_args, ctx) => {
  const list = Array.from(ctx.docStore.entries()).map(([doc_id, info]) => ({
    doc_id,
    filename: info.filename,
    file_type: info.file_type,
  }));
  pushToolResult(ctx, JSON.stringify(list));
};

const fetchDocuments: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, write, nonce } = ctx;
  const rawDocIds = (args.doc_ids as string[]) ?? [];
  const docIds = rawDocIds.map(
    (id) => resolveDocLabel(id, docStore, docIndex) ?? id,
  );
  const parts: string[] = [];
  for (const docId of docIds) {
    const content = await readDocumentContent(
      docId,
      docStore,
      write,
      docIndex,
      db,
    );
    const filename = docStore.get(docId)?.filename ?? docId;
    // Document body is user-controlled; spotlight it.
    const fencedContent = nonce ? spotlight(content, nonce) : content;
    parts.push(
      `--- ${filename} (${docId}) ---\n${citationReminder(docId, filename)}\n\n${fencedContent}`,
    );
    if (docStore.get(docId)) {
      const documentId = docIndex?.[docId]?.document_id;
      ctx.results.docsRead.push({ filename, document_id: documentId });
    }
  }
  pushToolResult(ctx, parts.join("\n\n"));
};

const editDocument: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, write, userId, turnEditState } = ctx;
  if (!docIndex) return;
  const rawDocId = args.doc_id as string;
  const editsRaw = args.edits as unknown[] | undefined;
  const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
  const docInfo = docStore.get(docId);
  const indexed = docIndex?.[docId];

  const emitEditError = (
    filename: string,
    documentId: string,
    error: string,
  ) => {
    // Surface the failure as a failed "Edited" block in the UI
    // (start → done-with-error) so it matches the shape the
    // success/late-failure paths already use.
    write(
      `data: ${JSON.stringify({
        type: "doc_edited_start",
        filename,
      })}\n\n`,
    );
    write(
      `data: ${JSON.stringify({
        type: "doc_edited",
        filename,
        document_id: documentId,
        version_id: "",
        download_url: "",
        annotations: [],
        error,
      })}\n\n`,
    );
  };

  if (!docInfo || !indexed) {
    const err = `Document '${docId}' not found in this chat's attachments.`;
    emitEditError(docId, indexed?.document_id ?? "", err);
    pushToolResult(ctx, JSON.stringify({ error: err }));
  } else if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
    const err = "edits array is required and must not be empty.";
    emitEditError(docInfo.filename, indexed.document_id, err);
    pushToolResult(ctx, JSON.stringify({ error: err }));
  } else if (docInfo.file_type !== "docx") {
    const err = "edit_document only supports .docx files.";
    emitEditError(docInfo.filename, indexed.document_id, err);
    pushToolResult(ctx, JSON.stringify({ error: err }));
  } else {
    write(
      `data: ${JSON.stringify({
        type: "doc_edited_start",
        filename: docInfo.filename,
      })}\n\n`,
    );
    const edits: EditInput[] = (editsRaw as Record<string, unknown>[]).map(
      (e) => ({
        find: String(e.find ?? ""),
        replace: String(e.replace ?? ""),
        context_before: String(e.context_before ?? ""),
        context_after: String(e.context_after ?? ""),
        reason: e.reason ? String(e.reason) : undefined,
      }),
    );
    const reuseVersion = turnEditState?.get(indexed.document_id);
    const result = await runEditDocument({
      documentId: indexed.document_id,
      userId,
      edits,
      db,
      reuseVersion,
    });

    if (result.ok) {
      turnEditState?.set(indexed.document_id, {
        versionId: result.version_id,
        versionNumber: result.version_number,
        storagePath: result.storage_path,
      });
      // Keep the chat-local doc label pointed at the latest
      // edited version so any follow-up read_document call in
      // the same assistant turn reads and cites the same bytes.
      if (docIndex[docId]) {
        docIndex[docId] = {
          ...docIndex[docId],
          version_id: result.version_id,
          version_number: result.version_number,
        };
      }
      const currentDocStore = docStore.get(docId);
      if (currentDocStore) {
        docStore.set(docId, {
          ...currentDocStore,
          storage_path: result.storage_path,
        });
      }
      const payload: DocEditedResult = {
        filename: docInfo.filename,
        document_id: indexed.document_id,
        version_id: result.version_id,
        version_number: result.version_number,
        download_url: result.download_url,
        annotations: result.annotations,
      };
      ctx.results.docsEdited.push(payload);
      write(
        `data: ${JSON.stringify({
          type: "doc_edited",
          ...payload,
        })}\n\n`,
      );
      pushToolResult(
        ctx,
        JSON.stringify({
          ok: true,
          doc_id: docId,
          document_id: indexed.document_id,
          version_id: result.version_id,
          version_number: result.version_number,
          applied: result.annotations.length,
          errors: result.errors,
          next_required_action: [
            `The edited document remains available as doc_id "${docId}".`,
            `Before making factual claims about the edited document's final contents, call read_document with doc_id "${docId}" and base the response on that returned text.`,
            `Do not include download links or URLs in your prose response; the edited document card is shown automatically by the UI.`,
            `If you describe specific content from the edited document, cite it with [N] markers and a final <CITATIONS> block using doc_id "${docId}".`,
          ].join(" "),
        }),
      );
    } else {
      write(
        `data: ${JSON.stringify({
          type: "doc_edited",
          filename: docInfo.filename,
          document_id: indexed.document_id,
          version_id: "",
          download_url: "",
          annotations: [],
          error: result.error,
        })}\n\n`,
      );
      pushToolResult(
        ctx,
        JSON.stringify({
          ok: false,
          error: result.error,
        }),
      );
    }
  }
};

const replicateDocument: ToolHandler = async (args, ctx) => {
  const { docStore, db, write, userId, projectId } = ctx;
  const docIndex = ctx.docIndex;
  if (!docIndex) return;
  const rawDocId = args.doc_id as string;
  const requestedFilename =
    typeof args.new_filename === "string" && args.new_filename.trim()
      ? args.new_filename.trim()
      : null;
  const requestedCount =
    typeof args.count === "number" && Number.isFinite(args.count)
      ? Math.max(1, Math.min(20, Math.floor(args.count)))
      : 1;
  const sourceLabel = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
  const sourceInfo = docStore.get(sourceLabel);
  const sourceIndexed = docIndex[sourceLabel];
  const sourceFilename = sourceInfo?.filename ?? rawDocId;

  write(
    `data: ${JSON.stringify({
      type: "doc_replicate_start",
      filename: sourceFilename,
      count: requestedCount,
    })}\n\n`,
  );

  const fail = (error: string) => {
    write(
      `data: ${JSON.stringify({
        type: "doc_replicated",
        filename: sourceFilename,
        count: requestedCount,
        copies: [],
        error,
      })}\n\n`,
    );
    pushToolResult(ctx, JSON.stringify({ ok: false, error }));
  };

  if (!sourceInfo || !sourceIndexed) {
    fail(`Document '${rawDocId}' not found in this project.`);
  } else if (!projectId) {
    fail("replicate_document is only available in project chats.");
  } else {
    try {
      // Pull the active version once — every copy gets the
      // same starting bytes (with any accepted tracked
      // changes rolled in), no point re-fetching per copy.
      const active = await loadActiveVersion(sourceIndexed.document_id, db);
      const sourcePath = active?.storage_path ?? sourceInfo.storage_path;
      const sourcePdfPath = active?.pdf_storage_path ?? null;
      const raw = await downloadFile(sourcePath);
      const pdfBytes = sourcePdfPath ? await downloadFile(sourcePdfPath) : null;
      if (!raw) {
        fail("Could not read the source document's bytes from storage.");
      } else {
        // Build N filenames. With count=1 keep the
        // pre-existing "(copy)" suffix; with count>1 use
        // numbered "(1)", "(2)" suffixes.
        const srcExt = sourceInfo.filename.match(/\.[^./\\]+$/)?.[0] ?? "";
        const baseStem = (() => {
          if (requestedFilename) {
            return requestedFilename.replace(/\.[^./\\]+$/, "");
          }
          return sourceInfo.filename.replace(/\.[^./\\]+$/, "");
        })();
        const filenames: string[] = [];
        for (let n = 1; n <= requestedCount; n++) {
          const suffix =
            requestedCount === 1
              ? requestedFilename
                ? ""
                : " (copy)"
              : ` (${n})`;
          filenames.push(`${baseStem}${suffix}${srcExt}`);
        }

        // Bulk insert N documents in one round-trip.
        const docRows = filenames.map((fn) => ({
          project_id: projectId,
          user_id: userId,
          // documents.filename is NOT NULL (baseline schema).
          filename: fn,
          status: "ready",
        }));
        const { data: insertedDocs, error: docErr } = await db
          .from("documents")
          .insert(docRows)
          .select("id");
        if (docErr || !insertedDocs || insertedDocs.length === 0) {
          fail(
            `Failed to record replicated documents: ${docErr?.message ?? "unknown"}`,
          );
        } else {
          // Preserve the request order so each row pairs
          // with the right filename. Supabase returns
          // inserted rows in the same order as the
          // payload.
          const newDocs = (insertedDocs as { id: string }[]).map(
            (doc, idx) => ({
              ...doc,
              filename: filenames[idx] ?? "Untitled document.docx",
            }),
          );
          const contentType =
            sourceInfo.file_type === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

          // Parallel uploads: the doc bytes (and PDF
          // rendition if any) for every new copy.
          const uploadJobs: Promise<unknown>[] = [];
          const newKeys: string[] = [];
          const newPdfKeys: (string | null)[] = [];
          for (const d of newDocs) {
            const key = storageKey(userId, d.id, d.filename);
            newKeys.push(key);
            uploadJobs.push(uploadFile(key, raw, contentType));
            if (pdfBytes) {
              const pdfKey = convertedPdfKey(userId, d.id);
              newPdfKeys.push(pdfKey);
              uploadJobs.push(uploadFile(pdfKey, pdfBytes, "application/pdf"));
            } else {
              newPdfKeys.push(null);
            }
          }
          await Promise.all(uploadJobs);

          // Bulk insert N versions in one round-trip.
          const versionRows = newDocs.map((d, idx) => ({
            document_id: d.id,
            storage_path: newKeys[idx],
            pdf_storage_path: newPdfKeys[idx],
            source: "upload",
            version_number: 1,
            filename: d.filename,
            file_type: active?.file_type ?? sourceInfo.file_type,
            size_bytes: active?.size_bytes ?? raw.byteLength,
            page_count: active?.page_count ?? null,
          }));
          const { data: insertedVersions, error: verErr } = await db
            .from("document_versions")
            .insert(versionRows)
            .select("id, document_id");
          if (
            verErr ||
            !insertedVersions ||
            insertedVersions.length !== newDocs.length
          ) {
            fail(
              `Failed to record replicated document versions: ${verErr?.message ?? "unknown"}`,
            );
          } else {
            const versionByDocId = new Map<string, string>();
            for (const v of insertedVersions as {
              id: string;
              document_id: string;
            }[]) {
              versionByDocId.set(v.document_id, v.id);
            }

            // current_version_id has to be a per-row
            // value, so a single UPDATE statement
            // can't cover all N. Fan out in parallel
            // instead of sequential awaits.
            await Promise.all(
              newDocs.map((d) =>
                db
                  .from("documents")
                  .update({
                    current_version_id: versionByDocId.get(d.id),
                  })
                  .eq("id", d.id),
              ),
            );

            // Register every copy under a fresh doc-N
            // slug so the model can edit/read any of
            // them in the same turn.
            const existingLabels = new Set(Object.keys(docIndex));
            let nextLabelIdx = 0;
            const copies: {
              new_filename: string;
              document_id: string;
              version_id: string;
            }[] = [];
            const toolPayloadCopies: {
              doc_id: string;
              document_id: string;
              version_id: string;
              filename: string;
              download_url: string;
            }[] = [];
            for (let idx = 0; idx < newDocs.length; idx++) {
              const d = newDocs[idx];
              const newKey = newKeys[idx];
              const versionId = versionByDocId.get(d.id);
              if (!versionId) continue;
              while (existingLabels.has(`doc-${nextLabelIdx}`)) nextLabelIdx++;
              const slug = `doc-${nextLabelIdx}`;
              existingLabels.add(slug);
              docIndex[slug] = {
                document_id: d.id,
                filename: d.filename,
              };
              docStore.set(slug, {
                storage_path: newKey,
                file_type: sourceInfo.file_type,
                filename: d.filename,
              });
              copies.push({
                new_filename: d.filename,
                document_id: d.id,
                version_id: versionId,
              });
              toolPayloadCopies.push({
                doc_id: slug,
                document_id: d.id,
                version_id: versionId,
                filename: d.filename,
                download_url: buildDownloadUrl(newKey, d.filename),
              });
            }

            write(
              `data: ${JSON.stringify({
                type: "doc_replicated",
                filename: sourceFilename,
                count: copies.length,
                copies,
              })}\n\n`,
            );
            ctx.results.docsReplicated.push({
              filename: sourceFilename,
              count: copies.length,
              copies,
            });
            pushToolResult(
              ctx,
              JSON.stringify({
                ok: true,
                count: copies.length,
                copies: toolPayloadCopies,
              }),
            );
          }
        }
      }
    } catch (e) {
      fail(`replicate_document failed: ${String(e)}`);
    }
  }
};

const generateDocxTool: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, write, userId, projectId } = ctx;
  const title = args.title as string;
  const landscape = !!args.landscape;
  logger.debug(
    { title, landscape, argsLandscape: args.landscape },
    "[generate_docx]",
  );
  const previewFilename = `${
    title
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .slice(0, 64) || "document"
  }.docx`;
  write(
    `data: ${JSON.stringify({ type: "doc_created_start", filename: previewFilename })}\n\n`,
  );
  const result = await generateDocx(
    title,
    args.sections as unknown[],
    userId,
    db,
    { landscape, projectId: projectId ?? null },
  );
  let newDocLabel: string | null = null;
  if ("filename" in result && "download_url" in result) {
    const dlFilename = result.filename as string;
    const dlUrl = result.download_url as string;
    const documentId = (result as { document_id?: string }).document_id;
    const versionId = (result as { version_id?: string }).version_id;
    const versionNumber =
      (result as { version_number?: number }).version_number ?? null;
    const storagePath = (result as { storage_path?: string }).storage_path;

    // Register the generated doc in the chat context so
    // edit_document (and read_document / find_in_document)
    // can act on it within the same assistant turn. New label
    // is the next free `doc-N` index. Subsequent turns pick
    // it up via the normal attachment/project doc query.
    if (documentId && storagePath && docIndex) {
      const existingLabels = new Set(Object.keys(docIndex));
      let i = 0;
      while (existingLabels.has(`doc-${i}`)) i++;
      newDocLabel = `doc-${i}`;
      docIndex[newDocLabel] = {
        document_id: documentId,
        filename: dlFilename,
      };
      docStore.set(newDocLabel, {
        storage_path: storagePath,
        file_type: "docx",
        filename: dlFilename,
      });
    }

    write(
      `data: ${JSON.stringify({
        type: "doc_created",
        filename: dlFilename,
        download_url: dlUrl,
        document_id: documentId,
        version_id: versionId,
        version_number: versionNumber,
      })}\n\n`,
    );
    ctx.results.docsCreated.push({
      filename: dlFilename,
      download_url: dlUrl,
      document_id: documentId,
      version_id: versionId,
      version_number: versionNumber,
    });
  } else {
    write(
      `data: ${JSON.stringify({ type: "doc_created", filename: previewFilename, download_url: "" })}\n\n`,
    );
  }
  // Surface the chat-local doc label in the tool result so the
  // model can pass it as `doc_id` to edit_document / read_document
  // / find_in_document in the same turn. Without this the model
  // only sees the DB UUID, which isn't valid as a doc_id anchor.
  const { download_url, storage_path, ...safeToolResult } = result as Record<
    string,
    unknown
  >;
  const toolResultPayload = newDocLabel
    ? {
        ...safeToolResult,
        doc_id: newDocLabel,
        next_required_action: [
          `Before writing your final response, call read_document with doc_id "${newDocLabel}".`,
          `Base your description on the generated document's actual returned text, not on memory of what you intended to generate.`,
          `Do not include download links, URLs, or markdown links to the document in your prose response; the document card is shown automatically by the UI.`,
          `Give a concise description of the generated document and, if you make factual claims about its contents, cite it with [N] markers and a final <CITATIONS> block using doc_id "${newDocLabel}", not any source/template document.`,
        ].join(" "),
      }
    : safeToolResult;
  pushToolResult(ctx, JSON.stringify(toolResultPayload));
};

const DEFAULT_SEARCH_TOP_K = 8;
const MAX_SEARCH_TOP_K = 25;

/**
 * Semantic top-k search across the chat's documents (RAG). Embeds the query with
 * the SAME model used at ingest, runs a cosine search scoped to the document ids
 * the chat already granted access to, and returns each chunk fenced + citable.
 *
 * SECURITY: the returned chunk text is user-controlled document body — it is
 * spotlight()-fenced with the turn nonce and carries a citationReminder, exactly
 * like read_document, so it cannot smuggle instructions into the model. The
 * cosine search is scoped to ctx.docIndex's document ids (the access-checked set
 * for this turn), so service_role can't return another tenant's chunks.
 */
const searchDocuments: ToolHandler = async (args, ctx) => {
  const { docStore, docIndex, db, apiKeys, nonce } = ctx;
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const rawTopK = typeof args.top_k === "number" ? args.top_k : DEFAULT_SEARCH_TOP_K;
  const topK = Math.max(1, Math.min(MAX_SEARCH_TOP_K, Math.floor(rawTopK)));

  if (!query) {
    pushToolResult(ctx, JSON.stringify({ error: "query is required." }));
    return;
  }
  if (!docIndex) {
    pushToolResult(ctx, JSON.stringify({ matches: [], note: "No documents in context." }));
    return;
  }

  // Map document_id -> { label, filename } from the access-checked doc index.
  // This is BOTH the citation-label source and the authz scope for the search.
  const byDocumentId = new Map<string, { label: string; filename: string }>();
  for (const [label, indexed] of Object.entries(docIndex)) {
    if (!byDocumentId.has(indexed.document_id)) {
      byDocumentId.set(indexed.document_id, {
        label,
        filename: indexed.filename,
      });
    }
  }

  // Optional narrowing to a single doc (accepts a doc-N label or a raw id).
  let documentIds = [...byDocumentId.keys()];
  if (typeof args.doc_id === "string" && args.doc_id.trim()) {
    const label = resolveDocLabel(args.doc_id, docStore, docIndex) ?? args.doc_id;
    const target = docIndex[label]?.document_id ?? args.doc_id;
    documentIds = documentIds.filter((id) => id === target);
  }

  if (documentIds.length === 0) {
    pushToolResult(ctx, JSON.stringify({ matches: [], note: "No matching documents in context." }));
    return;
  }

  const provider = getActiveEmbeddingProvider();
  if (!provider) {
    // Air-gapped with no local embedding model, or embeddings unconfigured.
    // Degrade gracefully — the model can still fall back to read_document.
    pushToolResult(
      ctx,
      JSON.stringify({
        matches: [],
        note: "Semantic search is unavailable in this deployment; use read_document or find_in_document instead.",
      }),
    );
    return;
  }

  const model = resolveEmbeddingModel();
  let matches;
  try {
    const [queryEmbedding] = await provider.embed([query], apiKeys);
    matches = await searchDocumentChunks({
      db,
      queryEmbedding: queryEmbedding ?? [],
      model,
      documentIds,
      topK,
    });
  } catch (err) {
    pushToolResult(
      ctx,
      JSON.stringify({ error: `Semantic search failed: ${String(err)}` }),
    );
    return;
  }

  if (matches.length === 0) {
    pushToolResult(ctx, JSON.stringify({ matches: [], note: "No relevant passages found." }));
    return;
  }

  // Record one docsFound entry per matched document for the UI chips.
  const perDoc = new Map<string, number>();
  for (const m of matches) perDoc.set(m.document_id, (perDoc.get(m.document_id) ?? 0) + 1);
  for (const [documentId, count] of perDoc) {
    const info = byDocumentId.get(documentId);
    if (info) {
      ctx.results.docsFound.push({
        filename: info.filename,
        query,
        total_matches: count,
      });
    }
  }

  // Fence each chunk as untrusted content and attach the doc-N citation
  // reminder, matching read_document/find_in_document.
  const parts = matches.map((m) => {
    const info = byDocumentId.get(m.document_id);
    const label = info?.label ?? m.document_id;
    const filename = info?.filename ?? m.document_id;
    const pageLine = m.page != null ? ` (page ${m.page})` : "";
    const header = `--- ${label} ("${filename}")${pageLine} ---\n${citationReminder(label, filename)}`;
    const body = nonce ? spotlight(m.content, nonce) : m.content;
    return `${header}\n\n${body}`;
  });

  pushToolResult(ctx, parts.join("\n\n"));
};

export const documentToolHandlers: Record<string, ToolHandler> = {
  read_document: readDocument,
  find_in_document: findInDocument,
  list_documents: listDocuments,
  fetch_documents: fetchDocuments,
  edit_document: editDocument,
  replicate_document: replicateDocument,
  generate_docx: generateDocxTool,
  search_documents: searchDocuments,
};
