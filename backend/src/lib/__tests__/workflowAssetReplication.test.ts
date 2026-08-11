import { beforeEach, describe, expect, it, vi } from "vitest";

const { downloadFile, uploadFile } = vi.hoisted(() => ({
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
}));

vi.mock("../storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../storage")>();
    return {
        ...actual,
        downloadFile: (...args: unknown[]) => downloadFile(...args),
        uploadFile: (...args: unknown[]) => uploadFile(...args),
    };
});

vi.mock("../downloadTokens", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../downloadTokens")>();
    return {
        ...actual,
        buildDownloadUrl: (_storagePath: string, filename: string) =>
            `/download/${encodeURIComponent(filename)}`,
    };
});

import { runToolCalls } from "../chat/tools/toolDispatcher";
import { PROJECT_EXTRA_TOOLS, TOOLS } from "../chat/tools/toolSchemas";
import type { DocIndex, DocStore, WorkflowStore } from "../chat/types";

function toolNames(tools: readonly { function: { name: string } }[]) {
    return tools.map((tool) => tool.function.name);
}

function replicationDb() {
    const documentRows: Record<string, unknown>[][] = [];
    const versionRows: Record<string, unknown>[][] = [];
    const db = {
        from(table: string) {
            if (table === "documents") {
                return {
                    insert(rows: Record<string, unknown>[]) {
                        documentRows.push(rows);
                        return {
                            select: async () => ({
                                data: rows.map((_, index) => ({
                                    id: `new-document-${index + 1}`,
                                })),
                                error: null,
                            }),
                        };
                    },
                    update: () => ({
                        eq: async () => ({ data: null, error: null }),
                    }),
                };
            }
            if (table === "document_versions") {
                return {
                    insert(rows: Record<string, unknown>[]) {
                        versionRows.push(rows);
                        return {
                            select: async () => ({
                                data: rows.map((row, index) => ({
                                    id: `new-version-${index + 1}`,
                                    document_id: row.document_id,
                                })),
                                error: null,
                            }),
                        };
                    },
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    };
    return { db, documentRows, versionRows };
}

describe("replicate_document availability", () => {
    it("is a base assistant tool rather than a project-only tool", () => {
        expect(toolNames(TOOLS)).toContain("replicate_document");
        expect(toolNames(PROJECT_EXTRA_TOOLS)).not.toContain("replicate_document");
    });
});

describe("workflow asset replication", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        downloadFile.mockResolvedValue(new TextEncoder().encode("asset").buffer);
        uploadFile.mockResolvedValue(undefined);
    });

    it("exposes workflow assets as immutable document handles", async () => {
        const store: DocStore = new Map();
        const workflows: WorkflowStore = new Map([
            [
                "workflow-12345678",
                {
                    title: "Draft from precedent",
                    skill_md: "Use the precedent.",
                    reference_files: [
                        {
                            reference_id: "reference-1",
                            filename: "Precedent.docx",
                            file_type: "docx",
                            storage_path: "workflow-assets/precedent.docx",
                        },
                    ],
                },
            ],
        ]);

        const result = await runToolCalls(
            [
                {
                    id: "read-workflow",
                    function: {
                        name: "read_workflow",
                        arguments: JSON.stringify({
                            workflow_id: "workflow-12345678",
                        }),
                    },
                },
            ],
            store,
            "user-1",
            {} as never,
            () => undefined,
            workflows,
            undefined,
            {},
        );

        expect(store.get("workflow-ref-workflow-1")).toMatchObject({
            filename: "Precedent.docx",
            source_kind: "workflow_asset",
            source_id: "reference-1",
        });
        expect(
            (result.toolResults[0] as { content: string }).content,
        ).toContain("Available immutable workflow reference files");
    });

    it("copies an asset into Library Files and registers the copy for editing", async () => {
        const sourceLabel = "workflow-ref-workflow-1-1";
        const store: DocStore = new Map([
            [
                sourceLabel,
                {
                    filename: "Precedent.pdf",
                    file_type: "pdf",
                    storage_path: "workflow-assets/precedent.pdf",
                    source_kind: "workflow_asset",
                    source_id: "reference-1",
                },
            ],
        ]);
        const index: DocIndex = {};
        const { db, documentRows, versionRows } = replicationDb();

        const result = await runToolCalls(
            [
                {
                    id: "replicate-asset",
                    function: {
                        name: "replicate_document",
                        arguments: JSON.stringify({
                            doc_id: sourceLabel,
                            new_filename: "Client precedent.pdf",
                        }),
                    },
                },
            ],
            store,
            "user-1",
            db as never,
            () => undefined,
            undefined,
            undefined,
            index,
        );

        expect(documentRows[0]).toEqual([
            expect.objectContaining({
                project_id: null,
                user_id: "user-1",
                library_kind: "file",
                library_folder_id: null,
            }),
        ]);
        expect(versionRows[0][0]).toMatchObject({
            filename: "Client precedent.pdf",
            file_type: "pdf",
            source: "upload",
        });
        expect(index["doc-0"]).toMatchObject({
            document_id: "new-document-1",
            filename: "Client precedent.pdf",
        });
        expect(store.get("doc-0")?.source_kind).toBe("document");
        const toolResult = result.toolResults[0] as { content: string };
        expect(JSON.parse(toolResult.content)).toMatchObject({
            ok: true,
            saved_to: "library_files",
        });
    });

    it("saves the same copy to Project Documents in a project chat", async () => {
        const sourceLabel = "workflow-ref-1";
        const store: DocStore = new Map([
            [
                sourceLabel,
                {
                    filename: "Precedent.pdf",
                    file_type: "pdf",
                    storage_path: "workflow-assets/precedent.pdf",
                    source_kind: "workflow_asset",
                },
            ],
        ]);
        const { db, documentRows } = replicationDb();

        const result = await runToolCalls(
            [
                {
                    id: "replicate-project-asset",
                    function: {
                        name: "replicate_document",
                        arguments: JSON.stringify({
                            doc_id: sourceLabel,
                            new_filename: "Project precedent.pdf",
                        }),
                    },
                },
            ],
            store,
            "user-1",
            db as never,
            () => undefined,
            undefined,
            undefined,
            {},
            undefined,
            undefined,
            "project-1",
        );

        expect(documentRows[0][0]).toMatchObject({
            project_id: "project-1",
            library_kind: "file",
        });
        const toolResult = result.toolResults[0] as { content: string };
        expect(JSON.parse(toolResult.content)).toMatchObject({
            ok: true,
            saved_to: "project_documents",
        });
    });

    it("requires a new name before copying immutable source material", async () => {
        const sourceLabel = "workflow-ref-1";
        const store: DocStore = new Map([
            [
                sourceLabel,
                {
                    filename: "Template.docx",
                    file_type: "docx",
                    storage_path: "workflow-assets/template.docx",
                    source_kind: "workflow_asset",
                },
            ],
        ]);

        const result = await runToolCalls(
            [
                {
                    id: "replicate-without-name",
                    function: {
                        name: "replicate_document",
                        arguments: JSON.stringify({ doc_id: sourceLabel }),
                    },
                },
            ],
            store,
            "user-1",
            {} as never,
            () => undefined,
            undefined,
            undefined,
            {},
        );

        expect(JSON.stringify(result.toolResults)).toContain("A new_filename is required");
        expect(downloadFile).not.toHaveBeenCalled();
    });

    it("refuses to edit a Library Template directly", async () => {
        const store: DocStore = new Map([
            [
                "doc-0",
                {
                    filename: "Template.docx",
                    file_type: "docx",
                    storage_path: "documents/template.docx",
                    source_kind: "library_template",
                },
            ],
        ]);

        const result = await runToolCalls(
            [
                {
                    id: "edit-template",
                    function: {
                        name: "edit_document",
                        arguments: JSON.stringify({
                            doc_id: "doc-0",
                            edits: [{ find: "A", replace: "B" }],
                        }),
                    },
                },
            ],
            store,
            "user-1",
            {} as never,
            () => undefined,
            undefined,
            undefined,
            {
                "doc-0": {
                    document_id: "template-document",
                    filename: "Template.docx",
                },
            },
        );

        expect(JSON.stringify(result.toolResults)).toContain("cannot be edited directly");
    });
});
