// Review-lifecycle services for the tabular module: building a review's rows
// from its selected documents (grouped per document or per folder), rebuilding
// them when the selection changes, and reconciling the cell grid to the active
// column set. Moved out of routes/tabular.ts; bodies unchanged.

import {
    fetchSourceDocuments,
    type ReviewRow,
    type SourceDocument,
} from "./tabular.rows";
import { type Column, type Db } from "./tabular.shared";

export type DocumentGrouping = "document" | "folder";

export function normalizeGrouping(value: unknown): DocumentGrouping {
    return value === "folder" ? "folder" : "document";
}

function buildFolderPathMap(
    folders: {
        id: string;
        name: string;
        parent_folder_id: string | null;
    }[],
): Map<string, string> {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const paths = new Map<string, string>();
    const resolve = (id: string): string => {
        const existing = paths.get(id);
        if (existing) return existing;
        const folder = byId.get(id);
        if (!folder) return "Unknown folder";
        const path = folder.parent_folder_id
            ? `${resolve(folder.parent_folder_id)} / ${folder.name}`
            : folder.name;
        paths.set(id, path);
        return path;
    };
    for (const folder of folders) resolve(folder.id);
    return paths;
}

async function getFolderPathMaps(
    db: Db,
    userId: string,
    docs: SourceDocument[],
): Promise<{
    project: Map<string, string>;
    library: Map<string, string>;
}> {
    const projectIds = [
        ...new Set(
            docs
                .map((doc) => doc.project_id)
                .filter((id): id is string => !!id),
        ),
    ];
    const [projectResult, libraryResult] = await Promise.all([
        projectIds.length
            ? db
                  .from("project_subfolders")
                  .select("id, name, parent_folder_id")
                  .in("project_id", projectIds)
            : Promise.resolve({ data: [] }),
        db
            .from("library_folders")
            .select("id, name, parent_folder_id")
            .eq("user_id", userId),
    ]);
    return {
        project: buildFolderPathMap(projectResult.data ?? []),
        library: buildFolderPathMap(libraryResult.data ?? []),
    };
}

export async function createRowsForReview(
    db: Db,
    reviewId: string,
    userId: string,
    documentIds: string[],
    columns: Column[],
    grouping: DocumentGrouping,
): Promise<void> {
    const docs = await fetchSourceDocuments(db, documentIds);
    const folderPaths = await getFolderPathMaps(db, userId, docs);
    const inputs: {
        label: string;
        row_type: "document" | "folder";
        folder_id: string | null;
        library_folder_id: string | null;
        document_id: string | null;
        sourceIds: string[];
    }[] = [];

    if (grouping === "folder") {
        const byFolder = new Map<
            string,
            {
                folder_id: string | null;
                library_folder_id: string | null;
                docs: SourceDocument[];
            }
        >();
        for (const doc of docs) {
            const folderKey = doc.folder_id
                ? `project:${doc.folder_id}`
                : doc.library_folder_id
                  ? `library:${doc.library_folder_id}`
                  : null;
            if (!folderKey) {
                inputs.push({
                    label: doc.filename,
                    row_type: "document",
                    folder_id: null,
                    library_folder_id: null,
                    document_id: doc.id,
                    sourceIds: [doc.id],
                });
                continue;
            }
            const existing = byFolder.get(folderKey);
            if (existing) {
                existing.docs.push(doc);
            } else {
                byFolder.set(folderKey, {
                    folder_id: doc.folder_id ?? null,
                    library_folder_id: doc.library_folder_id ?? null,
                    docs: [doc],
                });
            }
        }
        for (const folder of byFolder.values()) {
            const label = folder.folder_id
                ? folderPaths.project.get(folder.folder_id)
                : folder.library_folder_id
                  ? folderPaths.library.get(folder.library_folder_id)
                  : null;
            inputs.push({
                label: label ?? "Unknown folder",
                row_type: "folder",
                folder_id: folder.folder_id,
                library_folder_id: folder.library_folder_id,
                document_id: null,
                sourceIds: folder.docs.map((doc) => doc.id),
            });
        }
    } else {
        for (const doc of docs) {
            inputs.push({
                label: doc.filename,
                row_type: "document",
                folder_id: null,
                library_folder_id: null,
                document_id: doc.id,
                sourceIds: [doc.id],
            });
        }
    }

    inputs.sort((a, b) => a.label.localeCompare(b.label));
    if (inputs.length === 0) return;

    const { data, error } = await db
        .from("tabular_review_rows")
        .insert(
            inputs.map((input, sort_index) => ({
                review_id: reviewId,
                label: input.label,
                row_type: input.row_type,
                folder_id: input.folder_id,
                library_folder_id: input.library_folder_id,
                document_id: input.document_id,
                sort_index,
            })),
        )
        .select("*");
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as ReviewRow[]).sort(
        (a, b) => a.sort_index - b.sort_index,
    );
    const sources = rows.flatMap((row) =>
        (inputs[row.sort_index]?.sourceIds ?? []).map(
            (document_id, sort_index) => ({
                row_id: row.id,
                document_id,
                sort_index,
            }),
        ),
    );
    if (sources.length) {
        const { error: sourceError } = await db
            .from("tabular_review_row_sources")
            .insert(sources);
        if (sourceError) throw new Error(sourceError.message);
    }
    const cells = rows.flatMap((row) =>
        columns.map((column) => ({
            review_id: reviewId,
            row_id: row.id,
            document_id: row.document_id,
            column_index: column.index,
            status: "pending",
        })),
    );
    if (cells.length) {
        const { error: cellError } = await db
            .from("tabular_cells")
            .insert(cells);
        if (cellError) throw new Error(cellError.message);
    }
}

export async function rebuildRowsForReview(
    db: Db,
    reviewId: string,
    userId: string,
    documentIds: string[],
    columns: Column[],
    grouping: DocumentGrouping,
): Promise<void> {
    const { error } = await db
        .from("tabular_review_rows")
        .delete()
        .eq("review_id", reviewId);
    if (error) throw new Error(error.message);
    await createRowsForReview(
        db,
        reviewId,
        userId,
        documentIds,
        columns,
        grouping,
    );
}

export async function syncCellsForReviewRows(
    db: Db,
    reviewId: string,
    columns: Column[],
): Promise<void> {
    const { data: rows, error: rowsError } = await db
        .from("tabular_review_rows")
        .select("id,document_id")
        .eq("review_id", reviewId);
    if (rowsError) throw new Error(rowsError.message);
    const { data: cells, error: cellsError } = await db
        .from("tabular_cells")
        .select("id,row_id,column_index")
        .eq("review_id", reviewId);
    if (cellsError) throw new Error(cellsError.message);

    const activeColumnIndexes = new Set(columns.map((column) => column.index));
    const staleCellIds = (cells ?? [])
        .filter((cell) => !activeColumnIndexes.has(cell.column_index))
        .map((cell) => cell.id);
    if (staleCellIds.length) {
        const { error } = await db
            .from("tabular_cells")
            .delete()
            .in("id", staleCellIds);
        if (error) throw new Error(error.message);
    }

    const existingKeys = new Set(
        (cells ?? [])
            .filter((cell) => activeColumnIndexes.has(cell.column_index))
            .map((cell) => `${cell.row_id}:${cell.column_index}`),
    );
    const missingCells = (rows ?? []).flatMap((row) =>
        columns
            .filter((column) => !existingKeys.has(`${row.id}:${column.index}`))
            .map((column) => ({
                review_id: reviewId,
                row_id: row.id,
                document_id: row.document_id,
                column_index: column.index,
                status: "pending",
            })),
    );
    if (missingCells.length) {
        const { error } = await db.from("tabular_cells").insert(missingCells);
        if (error) throw new Error(error.message);
    }
}
