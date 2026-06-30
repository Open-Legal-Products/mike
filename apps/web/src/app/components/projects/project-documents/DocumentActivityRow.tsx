import { Loader2 } from "lucide-react";
import { DocIcon, DOC_NAME_COL_W, treeNameCellStyle } from "../ProjectPageParts";

/**
 * A muted, spinner-prefixed table row used for transient document states
 * (uploading, deleting). Purely presentational.
 */
export function DocumentActivityRow({
    stickyCellBg,
    filename,
    fileType,
    depth,
    statusLabel,
}: {
    stickyCellBg: string;
    filename: string;
    fileType: string | null;
    depth: number;
    statusLabel: string;
}) {
    return (
        <div className="group flex items-center h-10 pr-8 border-b border-gray-50">
            <div
                className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                style={treeNameCellStyle(depth)}
            >
                <div className="flex items-center gap-4">
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                    <DocIcon fileType={fileType} />
                    <span className="text-sm text-gray-400 truncate">
                        {filename}
                    </span>
                </div>
            </div>
            <div className="ml-auto w-20 shrink-0 text-xs text-gray-300 uppercase truncate">
                {fileType ??
                    (filename.includes(".")
                        ? filename.split(".").pop()
                        : "file")}
            </div>
            <div className="w-24 shrink-0 text-sm text-gray-300">
                {statusLabel}
            </div>
            <div className="w-20 shrink-0 text-sm text-gray-300">—</div>
            <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
            <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
            <div className="w-8 shrink-0" />
        </div>
    );
}
