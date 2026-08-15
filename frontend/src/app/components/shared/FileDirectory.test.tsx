import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document, Folder } from "./types";
import { FileDirectory } from "./FileDirectory";

const { loadFolderChildrenMock, loadMoreLibraryDocumentsMock } = vi.hoisted(
    () => ({
        loadFolderChildrenMock: vi.fn(async () => {}),
        loadMoreLibraryDocumentsMock: vi.fn(async () => {}),
    }),
);

vi.mock("./useDirectoryData", () => ({
    useDirectoryData: () => ({
        loadingTabs: {},
        standaloneDocuments: [
            {
                id: "library-document-1",
                filename: "Library agreement.pdf",
                file_type: "pdf",
                library_folder_id: "library-folder-1",
            },
        ],
        templateDocuments: [
            {
                id: "template-document-1",
                filename: "NDA template.docx",
                file_type: "docx",
                library_folder_id: "template-folder-1",
            },
        ],
        fileFolders: [
            {
                id: "library-folder-1",
                name: "Matter files",
                parent_folder_id: null,
                created_at: "2026-08-03T00:00:00.000Z",
            },
        ],
        templateFolders: [
            {
                id: "template-folder-1",
                name: "NDAs",
                parent_folder_id: null,
                created_at: "2026-08-03T00:00:00.000Z",
            },
        ],
        projects: [
            {
                id: "project-1",
                name: "Acquisition",
                cm_number: null,
                created_at: "2026-08-03T00:00:00.000Z",
                documents: [
                    {
                        id: "project-document-1",
                        filename: "Disclosure letter.docx",
                        file_type: "docx",
                        folder_id: "project-folder-1",
                    },
                ],
                folders: [
                    {
                        id: "project-folder-1",
                        name: "Disclosure",
                        parent_folder_id: null,
                        created_at: "2026-08-03T00:00:00.000Z",
                    },
                ],
            },
        ],
        loadedFolderIds: { files: new Set(), templates: new Set() },
        loadingFolderIds: { files: new Set(), templates: new Set() },
        documentsHasMoreByLevel: {
            files: { "library-folder-1": true },
            templates: {},
        },
        loadingMoreDocumentsByLevel: { files: {}, templates: {} },
        loadTab: vi.fn(),
        loadFolderChildren: loadFolderChildrenMock,
        loadMoreLibraryDocuments: loadMoreLibraryDocumentsMock,
    }),
}));

describe("FileDirectory", () => {
    beforeEach(() => {
        loadFolderChildrenMock.mockClear();
        loadMoreLibraryDocumentsMock.mockClear();
    });

    it("renders supplied project folders and reveals their documents", () => {
        const folder = {
            id: "folder-1",
            name: "Closing documents",
            parent_folder_id: null,
            created_at: "2026-08-03T00:00:00.000Z",
        } as Folder;
        const document = {
            id: "document-1",
            filename: "Agreement.pdf",
            file_type: "pdf",
            folder_id: folder.id,
        } as Document;

        render(
            <FileDirectory
                documents={[document]}
                folders={[folder]}
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs={false}
            />,
        );

        expect(screen.getByText("Closing documents")).toBeInTheDocument();
        expect(screen.queryByText("Agreement.pdf")).not.toBeInTheDocument();
        const nameHeader = screen.getByText("Name");
        expect(nameHeader.parentElement?.firstElementChild).toBe(nameHeader);

        const folderRow = screen.getByText("Closing documents").closest("button");
        expect(folderRow).toHaveStyle({ paddingLeft: "8px" });
        fireEvent.click(folderRow!);

        expect(screen.getByText("Agreement.pdf")).toBeInTheDocument();
        expect(screen.getByText("Agreement.pdf").closest("button")).toHaveStyle({
            paddingLeft: "30px",
        });
    });

    it("renders folders inside projects on the Projects tab", () => {
        render(
            <FileDirectory
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs
                initialTab="projects"
            />,
        );

        fireEvent.click(screen.getByText("Acquisition"));
        expect(screen.getByText("Disclosure")).toBeInTheDocument();
        expect(
            screen.queryByText("Disclosure letter.docx"),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("Disclosure"));
        expect(screen.getByText("Disclosure letter.docx")).toBeInTheDocument();
    });

    it("only renders the configured tabs", () => {
        render(
            <FileDirectory
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs
                tabs={["files", "projects"]}
            />,
        );

        expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Projects" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Templates" }),
        ).not.toBeInTheDocument();
    });

    it("keeps already-attached documents checked and disabled", () => {
        const onChange = vi.fn();
        const document = {
            id: "document-1",
            filename: "Existing agreement.pdf",
            file_type: "pdf",
            project_id: "project-1",
        } as Document;

        render(
            <FileDirectory
                documents={[document]}
                selectedDocuments={[]}
                onChange={onChange}
                showTabs={false}
                disabledDocumentIds={new Set([document.id])}
            />,
        );

        const row = screen
            .getByText("Existing agreement.pdf")
            .closest("button");
        expect(row).toBeDisabled();
        fireEvent.click(row!);
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        ["files", "Matter files", "Library agreement.pdf"],
        ["templates", "NDAs", "NDA template.docx"],
    ] as const)(
        "renders folders on the %s tab",
        (initialTab, folderName, filename) => {
            render(
                <FileDirectory
                    selectedDocuments={[]}
                    onChange={vi.fn()}
                    showTabs
                    initialTab={initialTab}
                />,
            );

            expect(screen.getByText(folderName)).toBeInTheDocument();
            expect(screen.queryByText(filename)).not.toBeInTheDocument();

            fireEvent.click(screen.getByText(folderName));
            expect(screen.getByText(filename)).toBeInTheDocument();
        },
    );

    it("loads a library folder and its next document page on demand", () => {
        render(
            <FileDirectory
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs
                initialTab="files"
            />,
        );

        fireEvent.click(screen.getByText("Matter files"));
        expect(loadFolderChildrenMock).toHaveBeenCalledWith(
            "files",
            "library-folder-1",
        );

        fireEvent.click(screen.getByRole("button", { name: "Load more" }));
        expect(loadMoreLibraryDocumentsMock).toHaveBeenCalledWith(
            "files",
            "library-folder-1",
        );
    });
});
