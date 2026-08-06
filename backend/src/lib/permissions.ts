/**
 * Project-scoped roles and the capability matrix.
 *
 * Every access decision reduces to: derive the caller's ProjectRole for the
 * container (lib/access.ts), then ask `can(role, capability)` here. Routes
 * never compare roles or re-derive rights from `isOwner` — they declare the
 * capability they need, so the policy lives in exactly one table.
 *
 * The ladder (each tier includes everything below it):
 *
 *   role     | granted to
 *   ---------|------------------------------------------------------------
 *   owner    | the row's user_id
 *   manager  | org owner/admin of the row's org
 *   editor   | shared_with email collaborators
 *   viewer   | plain org members (visibility, not ownership)
 *
 *   capability       | min role | covers
 *   -----------------|----------|--------------------------------------------
 *   project.view     | viewer   | read docs/chats/reviews, download, watch
 *                    |          | generation streams
 *   content.edit     | editor   | upload documents, push versions, chat,
 *                    |          | accept/reject edits, run extractions
 *   docs.organize    | editor   | rename/move documents, create folders
 *   structure.manage | manager  | rename/move/delete folders, clear review
 *                    |          | cells, edit review columns/document set
 *   members.manage   | manager  | edit shared_with and project metadata
 *   container.delete | owner    | delete the project/review itself
 *
 * The editor/manager split is the load-bearing line (Drive's writer vs.
 * fileOrganizer): content collaboration is broad, structural and destructive
 * power is narrow. `container.delete` stays owner-only so tenant admins can
 * curate content without being able to erase a colleague's container.
 */

export type ProjectRole = "owner" | "manager" | "editor" | "viewer";

export type Capability =
    | "project.view"
    | "content.edit"
    | "docs.organize"
    | "structure.manage"
    | "members.manage"
    | "container.delete";

const ROLE_RANK: Record<ProjectRole, number> = {
    viewer: 0,
    editor: 1,
    manager: 2,
    owner: 3,
};

const REQUIRED_RANK: Record<Capability, number> = {
    "project.view": ROLE_RANK.viewer,
    "content.edit": ROLE_RANK.editor,
    "docs.organize": ROLE_RANK.editor,
    "structure.manage": ROLE_RANK.manager,
    "members.manage": ROLE_RANK.manager,
    "container.delete": ROLE_RANK.owner,
};

/** Fail closed: an absent/unknown role can do nothing. */
export function can(
    role: ProjectRole | null | undefined,
    capability: Capability,
): boolean {
    if (!role || !(role in ROLE_RANK)) return false;
    return ROLE_RANK[role] >= REQUIRED_RANK[capability];
}
