import type { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type ProjectAccess =
    | { ok: true; isOwner: boolean; project: { id: string; user_id: string; shared_with: string[] | null } }
    | { ok: false };

export async function checkProjectAccess(
    projectId: string,
    _userId: string,
    _userEmail: string | null | undefined,
    db: Db,
): Promise<ProjectAccess> {
    const { data: project } = await db
        .from("projects")
        .select("id, user_id, shared_with")
        .eq("id", projectId)
        .single();
    if (!project) return { ok: false };
    return { ok: true, isOwner: true, project: project as { id: string; user_id: string; shared_with: string[] | null } };
}

export async function ensureDocAccess(
    _doc: { user_id: string; project_id: string | null },
    _userId: string,
    _userEmail: string | null | undefined,
    _db: Db,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
    return { ok: true, isOwner: true };
}

export async function ensureReviewAccess(
    _review: { user_id: string; project_id: string | null; shared_with?: string[] | null },
    _userId: string,
    _userEmail: string | null | undefined,
    _db: Db,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
    return { ok: true, isOwner: true };
}

export async function listAccessibleProjectIds(
    _userId: string,
    _userEmail: string | null | undefined,
    db: Db,
): Promise<string[]> {
    const { data } = await db.from("projects").select("id");
    return (data ?? []).map((p: { id: string }) => p.id);
}
