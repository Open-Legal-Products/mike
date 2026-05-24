import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
    filterAccessibleDocumentIds,
    listAccessibleProjectIds,
} from "../../lib/access";

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const maybeDescribe = url && serviceKey ? describe : describe.skip;

maybeDescribe("Supabase access integration", () => {
    it("proves tabular document filtering drops foreign document IDs", async () => {
        const admin = createClient(url!, serviceKey!, {
            auth: { persistSession: false },
        });
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const ownerId = crypto.randomUUID();
        const reviewerId = crypto.randomUUID();
        const sharedProjectId = crypto.randomUUID();
        const privateProjectId = crypto.randomUUID();
        const sharedDocId = crypto.randomUUID();
        const privateDocId = crypto.randomUUID();

        try {
            await admin.from("projects").insert([
                {
                    id: sharedProjectId,
                    user_id: ownerId,
                    name: `shared-${suffix}`,
                    shared_with: [`reviewer-${suffix}@example.com`],
                },
                {
                    id: privateProjectId,
                    user_id: ownerId,
                    name: `private-${suffix}`,
                    shared_with: [],
                },
            ]);
            await admin.from("documents").insert([
                {
                    id: sharedDocId,
                    user_id: ownerId,
                    project_id: sharedProjectId,
                    filename: "shared.pdf",
                    file_type: "pdf",
                },
                {
                    id: privateDocId,
                    user_id: ownerId,
                    project_id: privateProjectId,
                    filename: "private.pdf",
                    file_type: "pdf",
                },
            ]);

            await expect(
                listAccessibleProjectIds(
                    reviewerId,
                    `reviewer-${suffix}@example.com`,
                    admin as any,
                ),
            ).resolves.toContain(sharedProjectId);

            await expect(
                filterAccessibleDocumentIds(
                    [sharedDocId, privateDocId],
                    reviewerId,
                    `reviewer-${suffix}@example.com`,
                    admin as any,
                ),
            ).resolves.toEqual([sharedDocId]);
        } finally {
            await admin.from("documents").delete().in("id", [sharedDocId, privateDocId]);
            await admin
                .from("projects")
                .delete()
                .in("id", [sharedProjectId, privateProjectId]);
        }
    });
});
