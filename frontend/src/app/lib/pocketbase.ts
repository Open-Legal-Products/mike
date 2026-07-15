import PocketBase from "pocketbase";

const POCKETBASE_URL =
    process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

/**
 * Returns the current auth token (JWT) for the logged-in user, or null.
 * This is the PocketBase-equivalent of `supabase.auth.getSession().access_token`
 * and is sent as a Bearer token to the Mike backend API.
 */
export function getAuthToken(): string | null {
    return pb.authStore.isValid ? pb.authStore.token : null;
}

export function getAuthUser(): { id: string; email: string } | null {
    const model = pb.authStore.record as
        | { id: string; email?: string }
        | null;
    if (!model?.id) return null;
    return { id: model.id, email: model.email || "" };
}
