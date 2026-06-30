import path from "path";

const STANDARD_FONT_DATA_URL = (() => {
  try {
    const pkgPath = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkgPath), "standard_fonts") + path.sep;
  } catch {
    return undefined;
  }
})();

export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{
            numPages: number;
            getPage: (n: number) => Promise<{
              getTextContent: () => Promise<{
                items: { str?: string }[];
              }>;
            }>;
          }>;
        };
      }
    ).getDocument({
      data: new Uint8Array(buf),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      parts.push(
        `[Page ${i}]\n${textContent.items.map((it) => it.str ?? "").join(" ")}`,
      );
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}
