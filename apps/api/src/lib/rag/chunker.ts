import { getEncoding, type Tiktoken } from "js-tiktoken";

/**
 * Token-aware markdown chunker for the embedding pipeline.
 *
 * Consumes the SAME markdown the tabular path produces (extractPdfMarkdown /
 * extractDocxMarkdown): extractPdfMarkdown emits "## Page N" headers, which we
 * parse so every chunk carries the page it started on — that page flows into
 * the citation metadata the search_documents tool returns ({page, quote}).
 *
 * Tokenisation uses js-tiktoken's cl100k_base (pure JS, bundles its ranks — no
 * native binary, no network, sandbox-safe). It is only an APPROXIMATION of the
 * embedding model's own tokenizer (esp. Gemini/Ollama), so budgets are best-
 * effort and we also apply a hard character cap per chunk as a safety valve.
 */

export interface ChunkOptions {
    /** Target tokens per chunk. */
    targetTokens?: number;
    /** Tokens of overlap between consecutive chunks (context continuity). */
    overlapTokens?: number;
    /** Hard per-chunk character cap (safety net against tokenizer drift). */
    maxChunkChars?: number;
}

export interface DocumentChunk {
    chunkIndex: number;
    content: string;
    /** 1-based page from the nearest preceding "## Page N", or null (e.g. DOCX). */
    page: number | null;
    tokenCount: number;
}

const DEFAULTS = {
    targetTokens: 512,
    overlapTokens: 64,
    maxChunkChars: 8000,
};

const PAGE_HEADER_RE = /^##\s+Page\s+(\d+)\s*$/i;

let _encoder: Tiktoken | null = null;
function encoder(): Tiktoken {
    if (!_encoder) _encoder = getEncoding("cl100k_base");
    return _encoder;
}

/** A run of body text tagged with the page it belongs to. */
interface PagedUnit {
    text: string;
    page: number | null;
}

/**
 * Split markdown into page-tagged units. "## Page N" headers are consumed (not
 * emitted as content) but advance the current page for everything after them.
 */
function parsePagedUnits(markdown: string): PagedUnit[] {
    const units: PagedUnit[] = [];
    let page: number | null = null;
    let buffer: string[] = [];

    const flush = () => {
        const text = buffer.join("\n").trim();
        if (text) units.push({ text, page });
        buffer = [];
    };

    for (const line of markdown.split(/\r?\n/)) {
        const m = line.match(PAGE_HEADER_RE);
        if (m) {
            flush();
            page = Number.parseInt(m[1], 10);
            continue;
        }
        buffer.push(line);
    }
    flush();
    return units;
}

/**
 * Chunk markdown into overlapping, token-budgeted windows with page attribution.
 *
 * Empty / whitespace-only input yields no chunks. Input smaller than the target
 * yields a single chunk. A single oversized unit is split across windows too —
 * windowing runs over one flat token stream, so nothing exceeds the budget.
 */
export function chunkMarkdown(
    markdown: string,
    options: ChunkOptions = {},
): DocumentChunk[] {
    const targetTokens = options.targetTokens ?? DEFAULTS.targetTokens;
    const overlapTokens = Math.min(
        options.overlapTokens ?? DEFAULTS.overlapTokens,
        Math.max(0, targetTokens - 1),
    );
    const maxChunkChars = options.maxChunkChars ?? DEFAULTS.maxChunkChars;
    const step = Math.max(1, targetTokens - overlapTokens);

    const enc = encoder();
    const units = parsePagedUnits(markdown);

    // Flatten to one token stream while remembering the page of each token, so a
    // window that spans a page break is attributed to the page it starts on.
    const tokens: number[] = [];
    const tokenPages: (number | null)[] = [];
    const separator = enc.encode("\n\n");
    units.forEach((unit, i) => {
        if (i > 0) {
            for (const t of separator) {
                tokens.push(t);
                tokenPages.push(unit.page);
            }
        }
        for (const t of enc.encode(unit.text)) {
            tokens.push(t);
            tokenPages.push(unit.page);
        }
    });

    const chunks: DocumentChunk[] = [];
    for (let start = 0; start < tokens.length; start += step) {
        const slice = tokens.slice(start, start + targetTokens);
        let content = enc.decode(slice).trim();
        if (content.length > maxChunkChars) content = content.slice(0, maxChunkChars);
        if (content) {
            chunks.push({
                chunkIndex: chunks.length,
                content,
                page: tokenPages[start] ?? null,
                tokenCount: slice.length,
            });
        }
        if (start + targetTokens >= tokens.length) break;
    }
    return chunks;
}

/** Token count for a string under the same encoder the chunker uses. */
export function countTokens(text: string): number {
    return encoder().encode(text).length;
}
