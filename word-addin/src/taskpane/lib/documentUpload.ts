export const SUPPORTED_DOCUMENT_ACCEPT =
  ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt";

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "ppt",
]);

export function partitionSupportedDocumentFiles(files: File[]): {
  supported: File[];
  unsupported: File[];
} {
  const supported: File[] = [];
  const unsupported: File[] = [];

  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    (extension && SUPPORTED_EXTENSIONS.has(extension)
      ? supported
      : unsupported
    ).push(file);
  }

  return { supported, unsupported };
}
