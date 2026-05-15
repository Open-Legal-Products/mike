import type { RequestHandler } from "../http/compat";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);

export function singleFileUpload(fieldName: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const form = await req.raw.formData();
      const file = form.get(fieldName);
      if (!(file instanceof File)) return next();

      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.byteLength > MAX_UPLOAD_SIZE_BYTES) {
        return void res.status(413).json({
          detail: `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
        });
      }

      req.file = {
        fieldname: fieldName,
        originalname: file.name,
        mimetype: file.type,
        size: bytes.byteLength,
        buffer: bytes,
      };

      const body: Record<string, unknown> = {};
      form.forEach((value, key) => {
        if (value instanceof File) return;
        body[key] = value;
      });
      req.body = body;
      next();
    } catch (err) {
      next(err);
    }
  };
}
