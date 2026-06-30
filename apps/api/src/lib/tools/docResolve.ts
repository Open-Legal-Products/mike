import type { DocStore, DocIndex } from "../chatToolDefs";

export function resolveDoc(rawId: string, docIndex: DocIndex) {
  return docIndex[rawId];
}

/**
 * Resolve whatever identifier the model passed (`doc-N` slug, filename, or
 * document UUID) back to a chat-local doc label. Generated docs surface in
 * tool results with both `doc_id` (slug) and `document_id` (UUID), so the
 * model often picks the wrong one — without this fallback `read_document`
 * silently returns "not found" and the model gives up and re-generates.
 */
export function resolveDocLabel(
  rawId: string,
  docStore: DocStore,
  docIndex?: DocIndex,
): string | null {
  if (docStore.has(rawId)) return rawId;
  for (const [label, info] of docStore.entries()) {
    if (info.filename === rawId) return label;
  }
  if (docIndex) {
    for (const [label, info] of Object.entries(docIndex)) {
      if (info.document_id === rawId) return label;
    }
  }
  return null;
}
