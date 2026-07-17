// Magic-byte (file signature) validation adapted from upstream PR #78 by
// bmersereau (https://github.com/willchen96/mike/pull/78), extended here to
// the Office formats (xlsx/xlsm/pptx/xls/ppt).
import type { RequestHandler } from "express";
import multer from "multer";
import { sendError } from "./http";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);

// Magic-byte signatures for supported document types.
//
// WHY: A file's extension is supplied by the uploader and can be forged.
// An attacker can rename `malware.exe` to `contract.pdf` and bypass
// extension-only checks. Magic bytes are the actual binary signature
// embedded at the start of a file by the software that created it.
// They are format-independent and cannot be faked without producing a
// file that parsers (pdfjs, mammoth) would reject anyway.
//
// PDF: %PDF-  (0x25 50 44 46 2D)
// DOCX/DOC (ZIP): PK\x03\x04  (0x50 4B 03 04) — DOCX is a ZIP archive
// DOC (OLE2 Compound): \xD0\xCF\x11\xE0  (the OLE2 magic)
const MAGIC_SIGNATURES: Record<string, Buffer[]> = {
  pdf: [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  docx: [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP/DOCX
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // OLE2 (older Word)
  ],
  doc: [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP (just in case)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // OLE2
  ],
  // Office spreadsheets / presentations: OOXML formats are ZIP archives;
  // legacy .xls/.ppt are OLE2 compound files.
  xlsx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // ZIP/OOXML
  xlsm: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // ZIP/OOXML (macro-enabled)
  xls: [
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // OLE2
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP (just in case)
  ],
  pptx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // ZIP/OOXML
  ppt: [
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // OLE2
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP (just in case)
  ],
};

/**
 * Returns true if the buffer's leading bytes match any known magic signature
 * for the given file extension.  Falls back to true for unknown extensions
 * (so the extension-based allowlist in the route handler is still the gate).
 */
export function hasMagicBytes(buf: Buffer, ext: string): boolean {
  const sigs = MAGIC_SIGNATURES[ext.toLowerCase()];
  if (!sigs) return true;
  return sigs.some(
    (sig) => buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig),
  );
}

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
          return void sendError(
            res,
            413,
            "BAD_REQUEST",
            `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
          );
        }
        return void sendError(res, 400, "BAD_REQUEST", `Upload failed: ${err.message}`);
      }

      return next(err);
    });
  };
}
