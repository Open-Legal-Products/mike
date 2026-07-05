import { File, FileChartPie, FileSpreadsheet, FileText } from "lucide-react";

import { cn } from "@/lib/utils";

export type FileTypeKind = "pdf" | "word" | "excel" | "ppt" | "other";

/**
 * Normalize a `file_type` value (e.g. "pdf") or a filename (e.g. "deck.pptx")
 * into a coarse kind used to pick an icon. Accepts both because some call
 * sites only have the filename (user-message files, citations) while others
 * carry the document's `file_type` field. Null/undefined map to "other".
 */
export function fileTypeKind(value: string | null | undefined): FileTypeKind {
    const raw = (value ?? "").toLowerCase().trim();
    const ext = raw.includes(".") ? (raw.split(".").pop() ?? "") : raw;
    if (ext === "pdf") return "pdf";
    if (ext === "docx" || ext === "doc") return "word";
    if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "excel";
    if (ext === "pptx" || ext === "ppt") return "ppt";
    return "other";
}

/**
 * Canonical document file-type icon. Size and any extra classes come from
 * `className`; `shrink-0` is always applied so the icon never squishes inside
 * a flex row. `muted` renders a neutral grey placeholder (used for
 * loading/disabled rows) regardless of the resolved kind.
 */
export function FileTypeIcon({
    fileType,
    className = "h-3.5 w-3.5",
    muted = false,
}: {
    fileType: string | null | undefined;
    className?: string;
    muted?: boolean;
}) {
    const cls = cn(className, "shrink-0");
    if (muted) return <File className={cn(cls, "text-gray-300")} />;
    switch (fileTypeKind(fileType)) {
        case "pdf":
            return <FileText className={cn(cls, "text-red-500")} />;
        case "word":
            return <File className={cn(cls, "text-blue-500")} />;
        case "excel":
            return <FileSpreadsheet className={cn(cls, "text-emerald-500")} />;
        case "ppt":
            return <FileChartPie className={cn(cls, "text-red-500")} />;
        default:
            return <File className={cn(cls, "text-gray-500")} />;
    }
}
