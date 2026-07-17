import { type ToolHandler, pushToolResult } from "./context";

const readTableCells: ToolHandler = async (args, ctx) => {
  const { tabularStore, write } = ctx;
  // Without a tabular store this tool is unavailable; fall through silently
  // like the unknown-tool case (matches the pre-registry guard).
  if (!tabularStore) return;
  const colIndices = args.col_indices as number[] | undefined;
  const rowIndices = args.row_indices as number[] | undefined;

  const filteredCols = colIndices?.length
    ? tabularStore.columns.filter((_, i) => colIndices.includes(i))
    : tabularStore.columns;
  const filteredDocs = rowIndices?.length
    ? tabularStore.documents.filter((_, i) => rowIndices.includes(i))
    : tabularStore.documents;

  const label = `${filteredCols.length} ${filteredCols.length === 1 ? "column" : "columns"} × ${filteredDocs.length} ${filteredDocs.length === 1 ? "row" : "rows"}`;
  write(
    `data: ${JSON.stringify({ type: "doc_read_start", filename: label })}\n\n`,
  );

  const lines: string[] = [];
  for (const col of filteredCols) {
    const colPos = tabularStore.columns.findIndex((c) => c.index === col.index);
    for (const doc of filteredDocs) {
      const rowPos = tabularStore.documents.findIndex((d) => d.id === doc.id);
      const cell = tabularStore.cells.get(`${col.index}:${doc.id}`);
      lines.push(
        `[COL:${colPos} "${col.name}" | ROW:${rowPos} "${doc.filename}"]`,
      );
      if (cell?.summary) {
        lines.push(`Summary: ${cell.summary}`);
        if (cell.flag) lines.push(`Flag: ${cell.flag}`);
        if (cell.reasoning) lines.push(`Reasoning: ${cell.reasoning}`);
      } else {
        lines.push(`(not yet generated)`);
      }
      lines.push("");
    }
  }

  write(`data: ${JSON.stringify({ type: "doc_read", filename: label })}\n\n`);
  ctx.results.docsRead.push({ filename: label });
  pushToolResult(ctx, lines.join("\n") || "No cells found.");
};

export const tabularToolHandlers: Record<string, ToolHandler> = {
  read_table_cells: readTableCells,
};
