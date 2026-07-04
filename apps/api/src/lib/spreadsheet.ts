import * as XLSX from "xlsx";

/**
 * Spreadsheet parsing for the LLM read path.
 *
 * Replaces the old regex-over-OOXML extractor (`extractSpreadsheetText`) with a
 * real reader. SheetJS handles `.xlsx`, `.xlsm`, and legacy `.xls` uniformly and
 * exposes `cell.w` — the Excel-formatted display string — so dates and currency
 * reach the model the way a human sees them (`3/1/26`, `$1,200`) rather than as
 * raw serial numbers. Cached formula results are used (we never show formulas).
 *
 * The output is a compact, cell-addressed markdown table per sheet: a header row
 * of column letters plus a leftmost row-number column. That lets the model name
 * any cell as `Sheet!<col><row>` (e.g. `Q3 Budget!B7`) for cell-level citations,
 * with none of the old `Row N:` / `|`-separator noise.
 */

/** Formatted display text for a cell (`w`), falling back to the raw value. */
function cellDisplayText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (typeof cell.w === "string" && cell.w.length > 0) return cell.w;
  if (cell.v == null) return "";
  return String(cell.v);
}

/** Escape a cell value so it can't break the markdown table layout. */
function sanitizeCellText(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function renderSheet(sheetName: string, ws: XLSX.WorkSheet): string | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  // Build a trimmed grid: capture formatted text for every cell in the used
  // range, then drop trailing empty columns and fully empty rows so we don't
  // emit oceans of blank cells.
  const rows: { rowNumber: number; cells: string[] }[] = [];
  let lastNonEmptyCol = -1;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    let rowHasContent = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const text = sanitizeCellText(cellDisplayText(ws[addr]));
      cells[c - range.s.c] = text;
      if (text) {
        rowHasContent = true;
        if (c - range.s.c > lastNonEmptyCol) lastNonEmptyCol = c - range.s.c;
      }
    }
    if (rowHasContent) rows.push({ rowNumber: r + 1, cells });
  }

  if (rows.length === 0 || lastNonEmptyCol < 0) return null;

  // Column-letter header, e.g. ["A", "B", "C"] for the used columns.
  const colLetters: string[] = [];
  for (let c = 0; c <= lastNonEmptyCol; c++) {
    colLetters.push(XLSX.utils.encode_col(range.s.c + c));
  }

  const headerRow = `| Row | ${colLetters.join(" | ")} |`;
  const separator = `| --- | ${colLetters.map(() => "---").join(" | ")} |`;
  const bodyRows = rows.map(({ rowNumber, cells }) => {
    const padded: string[] = [];
    for (let c = 0; c <= lastNonEmptyCol; c++) padded.push(cells[c] ?? "");
    return `| ${rowNumber} | ${padded.join(" | ")} |`;
  });

  const lines = [`## Sheet: ${sheetName}`, "", headerRow, separator, ...bodyRows];

  // Note merged ranges once so the model understands spanned headers/labels.
  const merges = ws["!merges"];
  if (merges && merges.length > 0) {
    const encoded = merges.map((m) => XLSX.utils.encode_range(m));
    lines.push("", `Merged ranges: ${encoded.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Extract a spreadsheet as cell-addressed markdown for the LLM. Handles
 * `.xlsx`, `.xlsm`, and legacy `.xls` (SheetJS reads all three), so callers no
 * longer need the LibreOffice→PDF→text detour for spreadsheets.
 */
export function spreadsheetToLLMText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheets: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rendered = renderSheet(sheetName, ws);
    if (rendered) sheets.push(rendered);
  }
  return sheets.join("\n\n").trim();
}
