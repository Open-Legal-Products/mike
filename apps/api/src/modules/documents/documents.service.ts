// Business logic + data-access for the documents module.
//
// These functions are the service layer behind documents.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the storage / version / conversion orchestration, and RETURN values or
// typed error results. They never touch req/res — the thin route handlers map
// the results onto HTTP status codes, headers, and response bodies.
//
// This file is the module's stable facade: the implementation is decomposed
// into cohesive sibling files and re-exported here so importers never change.
//
//   documents.shared.ts    — shared types, constants, and helpers
//   documents.access.ts    — access guards + list/delete document
//   documents.download.ts  — display bytes, zip bundling, signed URLs, raw docx
//   documents.versions.ts  — version lifecycle (list/create/rename/replace/delete)
//   documents.edits.ts     — tracked-change ids + accept/reject edits
//   documents.upload.ts    — initial document creation from an uploaded file

export {
  DOCX_MIME,
  ALLOWED_TYPES,
  MAX_ZIP_DOCUMENTS,
  deleteDocumentAndVersionFiles,
  downloadFilenameForVersion,
  countPdfPages,
} from "./documents.shared";

export {
  checkDocumentAccess,
  listSingleDocuments,
  deleteDocument,
} from "./documents.access";

export {
  getDisplayableVersion,
  buildZipForDocuments,
  getDownloadUrl,
  getDocxBytes,
} from "./documents.download";

export {
  listVersions,
  createVersionFromDocument,
  addUploadedVersion,
  renameVersion,
  loadReplaceTarget,
  writeReplacementVersion,
  deleteVersion,
} from "./documents.versions";

export {
  getTrackedChangeIds,
  resolveEdit,
} from "./documents.edits";

export { createDocumentFromUpload } from "./documents.upload";
