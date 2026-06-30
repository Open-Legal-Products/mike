import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderRow } from "./FolderRow";
import type { Folder as ProjectFolder } from "@/app/components/shared/types";

const folder: ProjectFolder = {
    id: "folder-1",
    project_id: "project-1",
    user_id: "user-1",
    name: "Contracts",
    parent_folder_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

function renderFolderRow(overrides: Partial<React.ComponentProps<typeof FolderRow>> = {}) {
    return render(
        <FolderRow
            folder={folder}
            depth={2}
            stickyCellBg="bg-[#fafbfc]"
            isExpanded
            isRenaming={false}
            renameFolderValue=""
            dragOverFolderId={null}
            hasMovePayload={() => false}
            setDragOverFolderId={vi.fn()}
            setDragOverVersionDocId={vi.fn()}
            setDragOverRoot={vi.fn()}
            setRenameFolderValue={vi.fn()}
            setRenamingFolderId={vi.fn()}
            setContextMenu={vi.fn()}
            closeRowActionMenus={vi.fn()}
            handleDropOnFolder={vi.fn()}
            toggleFolder={vi.fn()}
            handleRenameFolder={vi.fn()}
            requestDeleteFolder={vi.fn()}
            {...overrides}
        />,
    );
}

describe("FolderRow ARIA", () => {
    it("exposes a treeitem with aria-expanded reflecting the open state", () => {
        renderFolderRow({ isExpanded: true });
        const treeitem = screen.getByRole("treeitem", { expanded: true });
        // depth 2 → 1-based aria-level 3
        expect(treeitem).toHaveAttribute("aria-level", "3");
        expect(screen.getByText("Contracts")).toBeInTheDocument();
    });

    it("marks a collapsed folder with aria-expanded=false", () => {
        renderFolderRow({ isExpanded: false });
        expect(screen.getByRole("treeitem", { expanded: false })).toBeInTheDocument();
    });
});
