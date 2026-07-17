// Business logic + data-access for the projects module.
//
// These functions are the service layer behind projects.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the project / document / folder orchestration, and RETURN values or typed
// error results. They never touch req/res — the thin route handlers map the
// results onto HTTP status codes, headers, and response bodies.
//
// The implementation is split by concern across sibling files; this module is
// the aggregate surface the routes (and tests) import from:
//
//   projects.shared.ts     — shared types + helpers (Db/Log, normalisers, …)
//   projects.crud.ts       — overview, create, detail, people, update, delete
//   projects.documents.ts  — list, assign/copy, rename, upload orchestration
//   projects.folders.ts    — subfolders + moving documents between them
//   projects.chats.ts      — list a project's chats

export {
  normalizeOptionalString,
  normalizeDocumentFilename,
} from "./projects.shared";

export {
  getProjectsOverview,
  createProject,
  getProjectDetail,
  getProjectPeople,
  updateProject,
  deleteProject,
  type CreateProjectResult,
  type UpdateProjectResult,
} from "./projects.crud";

export {
  listProjectDocuments,
  assignOrCopyDocument,
  renameProjectDocument,
  ensureProjectUploadAccess,
  processProjectDocumentUpload,
  type AssignOrCopyResult,
  type RenameDocumentResult,
  type UploadDocumentResult,
} from "./projects.documents";

export {
  createProjectFolder,
  updateProjectFolder,
  deleteProjectFolder,
  moveProjectDocument,
  type CreateFolderResult,
  type UpdateFolderResult,
  type DeleteFolderResult,
  type MoveDocumentResult,
} from "./projects.folders";

export { listProjectChats } from "./projects.chats";
