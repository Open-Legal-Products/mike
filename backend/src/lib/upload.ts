import type { RequestHandler } from "express";
import JSZip from "jszip";
import multer from "multer";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);
const MAX_DOCX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
});

export function singleFileUpload(fieldName: string): RequestHandler {
  return (req, res, next) => {
    memoryUpload.single(fieldName)(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return void res.status(413).json({
            detail: `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
          });
        }
        return void res.status(400).json({
          detail: `Upload failed: ${err.message}`,
        });
      }

      return next(err);
    });
  };
}

export const ALLOWED_DOCUMENT_TYPES = new Set(["pdf", "docx", "doc"]);

export type ValidatedDocumentUpload = {
  suffix: "pdf" | "docx" | "doc";
  contentType: string;
};

export async function validateDocumentUpload(
  file: Express.Multer.File,
): Promise<ValidatedDocumentUpload> {
  const suffix = getFileSuffix(file.originalname);
  if (!suffix || !ALLOWED_DOCUMENT_TYPES.has(suffix)) {
    throw new Error(
      `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
    );
  }

  if (suffix === "pdf") {
    if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("Uploaded PDF does not have a valid PDF header.");
    }
    return { suffix, contentType: "application/pdf" };
  }

  if (suffix === "doc") {
    const oleMagic = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    if (!file.buffer.subarray(0, 8).equals(oleMagic)) {
      throw new Error("Uploaded DOC does not have a valid legacy Word header.");
    }
    return {
      suffix,
      contentType: "application/msword",
    };
  }

  try {
    const zip = await JSZip.loadAsync(file.buffer);
    if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
      throw new Error("Uploaded DOCX is missing required Word document parts.");
    }

    let totalUncompressed = 0;
    zip.forEach((_path, entry) => {
      const data = entry as unknown as {
        _data?: { uncompressedSize?: number };
      };
      totalUncompressed += data._data?.uncompressedSize ?? 0;
    });
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new Error("Uploaded DOCX expands beyond the allowed size.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Uploaded DOCX")) {
      throw err;
    }
    throw new Error("Uploaded DOCX is not a valid Word archive.");
  }

  return {
    suffix,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function getFileSuffix(filename: string): ValidatedDocumentUpload["suffix"] | null {
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (suffix === "pdf" || suffix === "docx" || suffix === "doc") {
    return suffix;
  }
  return null;
}
