export const SUPPORTED_DOCUMENT_ACCEPT =
    ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt";
export const UNSUPPORTED_DOCUMENT_WARNING_MESSAGE =
    "Unsupported file type. Only PDF, Word, Excel, and PowerPoint files can be uploaded.";

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
    "pdf",
    "docx",
    "doc",
    "xlsx",
    "xlsm",
    "xls",
    "pptx",
    "ppt",
]);

export function isSupportedDocumentFile(file: File): boolean {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return !!extension && SUPPORTED_DOCUMENT_EXTENSIONS.has(extension);
}

export function partitionSupportedDocumentFiles(files: File[]) {
    const supported: File[] = [];
    const unsupported: File[] = [];

    for (const file of files) {
        if (isSupportedDocumentFile(file)) supported.push(file);
        else unsupported.push(file);
    }

    return { supported, unsupported };
}

export function formatUnsupportedDocumentWarning(files: File[]): string | null {
    if (files.length === 0) return null;
    return UNSUPPORTED_DOCUMENT_WARNING_MESSAGE;
}
