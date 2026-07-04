declare module "luckyexcel" {
  export interface LuckyExcelSheet {
    name: string;
    celldata?: unknown[];
    index?: string;
    order?: number;
    [key: string]: unknown;
  }

  export interface LuckyExcelJson {
    sheets: LuckyExcelSheet[];
    info?: { name?: string; creator?: string };
  }

  type TransformCallback = (
    exportJson: LuckyExcelJson,
    luckysheetfile: string,
  ) => void;

  const LuckyExcel: {
    transformExcelToLucky(file: File | Blob, callback: TransformCallback): void;
    transformExcelToLuckyByUrl(
      url: string,
      name: string,
      callback: TransformCallback,
    ): void;
  };

  export default LuckyExcel;
}
