import type { SupabaseClient } from "@supabase/supabase-js";

const ALLOWED_METADATA_KEYS = new Set([
    "boundaryVersion",
    "hostedMode",
    "provider",
    "result",
    "scope",
    "count",
]);

export function sanitizeAuditMetadata(
    metadata: Record<string, unknown> | undefined,
) {
    const sanitized: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(metadata ?? {})) {
        if (!ALLOWED_METADATA_KEYS.has(key)) continue;
        if (
            value === null ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))
        ) {
            sanitized[key] = value;
            continue;
        }
        if (typeof value === "string") sanitized[key] = value.slice(0, 120);
    }
    return sanitized;
}

export async function recordSecurityAuditEvent(args: {
    db: SupabaseClient;
    actorUserId: string | null;
    eventType: string;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
}) {
    if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(args.eventType))
        throw new Error("Invalid security audit event type.");
    const { error } = await args.db.from("security_audit_events").insert({
        actor_user_id: args.actorUserId,
        event_type: args.eventType,
        resource_type: args.resourceType?.slice(0, 80) ?? null,
        resource_id: args.resourceId?.slice(0, 160) ?? null,
        metadata: sanitizeAuditMetadata(args.metadata),
    });
    if (error) throw error;
}
