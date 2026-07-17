import assert from "node:assert/strict";
import test from "node:test";
import {
    recordSecurityAuditEvent,
    sanitizeAuditMetadata,
} from "./securityAudit";

test("audit metadata retains only bounded allowlisted scalar fields", () => {
    const sanitized = sanitizeAuditMetadata({
        boundaryVersion: "v1",
        result: "accepted",
        count: 2,
        prompt: "must not be retained",
        token: "secret",
        nested: { document: "body" },
    });
    assert.deepEqual(sanitized, {
        boundaryVersion: "v1",
        result: "accepted",
        count: 2,
    });
});

test("audit inserts a metadata-only service record", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
        from(table: string) {
            assert.equal(table, "security_audit_events");
            return {
                async insert(value: Record<string, unknown>) {
                    inserted.push(value);
                    return { error: null };
                },
            };
        },
    };
    await recordSecurityAuditEvent({
        db: db as never,
        actorUserId: "synthetic-user-id",
        eventType: "beta.data_boundary_acknowledged",
        metadata: { boundaryVersion: "v1", prompt: "excluded" },
    });
    assert.deepEqual(inserted[0].metadata, { boundaryVersion: "v1" });
    assert.equal("prompt" in inserted[0], false);
});

test("audit event types fail closed", async () => {
    await assert.rejects(
        () =>
            recordSecurityAuditEvent({
                db: {} as never,
                actorUserId: null,
                eventType: "INVALID EVENT",
            }),
        /Invalid security audit event type/,
    );
});
