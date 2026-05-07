import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canEditReview, ensureReviewAccess } from "../src/lib/access";
import { validateReviewDocumentIds } from "../src/routes/tabular";

describe("review access helpers", () => {
    it("treats direct standalone review shares as read-only", () => {
        assert.equal(
            canEditReview({ ok: true, isOwner: false, via: "direct" }),
            false,
        );
        assert.equal(
            canEditReview({ ok: true, isOwner: false, via: "project" }),
            true,
        );
        assert.equal(
            canEditReview({ ok: true, isOwner: true, via: "owner" }),
            true,
        );
    });

    it("validates review document IDs against project or owner scope", async () => {
        const docs = [
            {
                id: "project-doc",
                filename: "Project.docx",
                user_id: "owner-a",
                project_id: "project-a",
            },
            {
                id: "other-project-doc",
                filename: "Other.docx",
                user_id: "owner-a",
                project_id: "project-b",
            },
            {
                id: "standalone-doc",
                filename: "Standalone.docx",
                user_id: "owner-a",
                project_id: null,
            },
        ];
        const db = {
            from: () => ({
                select() {
                    return this;
                },
                in(_column: string, ids: string[]) {
                    return Promise.resolve({
                        data: docs.filter((doc) => ids.includes(doc.id)),
                    });
                },
            }),
        } as never;

        assert.deepEqual(
            await validateReviewDocumentIds(
                {
                    id: "review-a",
                    user_id: "owner-a",
                    project_id: "project-a",
                },
                ["project-doc"],
                db,
            ),
            { ok: true, documentIds: ["project-doc"] },
        );
        assert.equal(
            (
                await validateReviewDocumentIds(
                    {
                        id: "review-a",
                        user_id: "owner-a",
                        project_id: "project-a",
                    },
                    ["other-project-doc"],
                    db,
                )
            ).ok,
            false,
        );
        assert.deepEqual(
            await validateReviewDocumentIds(
                { id: "review-b", user_id: "owner-a", project_id: null },
                ["standalone-doc"],
                db,
            ),
            { ok: true, documentIds: ["standalone-doc"] },
        );
    });

    it("does not let direct email shares bypass project review access", async () => {
        const db = {
            from: () => ({
                select() {
                    return this;
                },
                eq() {
                    return this;
                },
                single() {
                    return Promise.resolve({ data: null });
                },
            }),
        } as never;

        assert.deepEqual(
            await ensureReviewAccess(
                {
                    user_id: "owner-a",
                    project_id: "project-a",
                    shared_with: ["viewer@example.com"],
                },
                "viewer-user-id",
                "viewer@example.com",
                db,
            ),
            { ok: false },
        );
    });
});
