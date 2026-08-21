// Client-side mirror of backend/src/lib/permissions.ts — the project role
// ladder and capability matrix. The server is the enforcement point; this
// exists so the UI can hide or disable affordances the server would reject,
// instead of offering actions that fail.

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

/**
 * Resolve a role from an API row. Detail endpoints return `access_role`
 * (for every role, including "owner"); list endpoints only return
 * `is_owner`, where a non-owner row means "shared with me" — historically
 * full edit access, so editor is the faithful fallback.
 *
 * A row carrying NEITHER field is not a detail or list payload — it's a
 * bare mutation response (PATCH handlers return the raw DB row). Guessing
 * "owner" there would silently open every client gate, so it resolves
 * viewer: fail closed, like `can` does for unknown roles.
 */
export function roleFrom(row: {
    access_role?: ProjectRole | null;
    is_owner?: boolean | null;
}): ProjectRole {
    if (row.access_role && row.access_role in ROLE_RANK)
        return row.access_role;
    if (row.is_owner === false) return "editor";
    if (row.is_owner === true) return "owner";
    return "viewer";
}
