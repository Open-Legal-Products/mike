import type { Document, Folder as ProjectFolder } from "@/app/components/shared/types";
import { currentVersionNumber } from "./helpers";

/** Body of the "Save as new version?" confirmation dialog. */
export function PendingVersionDropMessage({
    targetDoc,
    sourceDoc,
}: {
    targetDoc: Document;
    sourceDoc: Document;
}) {
    return (
        <div className="space-y-2">
            <p>
                You are about to save{" "}
                <span className="font-medium text-gray-950">
                    {sourceDoc.filename}
                </span>{" "}
                as a new version of{" "}
                <span className="font-medium text-gray-950">
                    {targetDoc.filename}
                </span>
                .
            </p>
            <p>
                <span className="font-medium text-gray-950">
                    {sourceDoc.filename}
                </span>{" "}
                will no longer exist as a separate document
                {(currentVersionNumber(sourceDoc) ?? 1) > 1
                    ? " and its older versions will be deleted"
                    : ""}
                .
            </p>
        </div>
    );
}

/** Body of the "Delete document?" confirmation dialog. */
export function PendingDeleteDocMessage({
    doc,
    versionCount,
}: {
    doc: Document;
    versionCount: number;
}) {
    return (
        <div className="space-y-2">
            <p>
                <span className="font-medium text-gray-950">
                    {doc.filename}
                </span>{" "}
                will be permanently deleted
                {versionCount > 1
                    ? `, including all ${versionCount} versions`
                    : ""}
                . This removes it from every project and review that uses it and
                can’t be undone.
            </p>
        </div>
    );
}

/** Body of the "Delete folder?" confirmation dialog. */
export function PendingDeleteFolderMessage({
    folder,
    folderIds,
    documentCount,
}: {
    folder: ProjectFolder;
    folderIds: string[];
    documentCount: number;
}) {
    return (
        <div className="space-y-2">
            <p>
                This will permanently delete{" "}
                <span className="font-medium text-gray-950">
                    {folderIds.length}{" "}
                    {folderIds.length === 1 ? "folder" : "folders"}
                </span>
                , including{" "}
                <span className="font-medium text-gray-950">{folder.name}</span>
                {folderIds.length > 1 ? " and its nested subfolders" : ""}.
            </p>
            {documentCount > 0 && (
                <p>
                    {documentCount}{" "}
                    {documentCount === 1 ? "document" : "documents"} in the
                    deleted {folderIds.length === 1 ? "folder" : "folders"} will
                    also be permanently deleted.
                </p>
            )}
        </div>
    );
}
