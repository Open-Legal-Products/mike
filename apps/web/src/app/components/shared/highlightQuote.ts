let pdfjsLib: typeof import("pdfjs-dist") | null = null;

export async function getPdfJs() {
    if (pdfjsLib) return pdfjsLib;
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
    ).toString();
    return pdfjsLib;
}

export const STANDARD_FONT_DATA_URL =
    "https://unpkg.com/pdfjs-dist@4.10.38/standard_fonts/";

const HIGHLIGHT_CLASS = "pdf-text-highlight";
const ORIGINAL_TEXT_ATTR = "data-original-text";

// Strip everything except alphanumerics (a-z A-Z 0-9) for robust matching
function onlyLetters(s: string): string {
    return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Given a position in the stripped (letters-only) version of `original`,
// return the corresponding index in `original`.
function strippedPosToOriginal(original: string, strippedPos: number): number {
    let count = 0;
    for (let i = 0; i < original.length; i++) {
        if (/[a-zA-Z0-9]/.test(original[i])) {
            if (count === strippedPos) return i;
            count++;
        }
    }
    return original.length;
}

export function clearHighlights(textDivs: HTMLElement[]) {
    for (const div of textDivs) {
        if (div.hasAttribute(ORIGINAL_TEXT_ATTR)) {
            div.textContent = div.getAttribute(ORIGINAL_TEXT_ATTR)!;
            div.removeAttribute(ORIGINAL_TEXT_ATTR);
        }
    }
}

export async function highlightQuote(
    textDivs: HTMLElement[],
    quote: string,
): Promise<boolean> {
    clearHighlights(textDivs);

    // Split on ellipsis variants to highlight each segment separately
    const segments = quote
        .split(/\.{3}|…/)
        .map((s) => onlyLetters(s))
        .filter((s) => s.length > 0);

    // Build the stripped full text and track each div's start position within it.
    // Also keep original div texts for display.
    const divOrigTexts: string[] = []; // original text for innerHTML slicing
    const divStripped: string[] = []; // letters-only version for matching
    const divStartInFull: number[] = []; // start index in fullStripped
    let fullStripped = "";

    for (let i = 0; i < textDivs.length; i++) {
        const orig = textDivs[i].textContent ?? "";
        divOrigTexts.push(orig);
        const stripped = onlyLetters(orig);
        divStripped.push(stripped);
        divStartInFull.push(fullStripped.length);
        fullStripped += stripped;
    }

    // Map: divIndex -> [strippedLocalStart, strippedLocalEnd]
    const divHighlightRanges = new Map<number, [number, number]>();

    for (const segment of segments) {
        const searchKey = segment.slice(0, 30);
        const matchPos = fullStripped.indexOf(searchKey);
        if (matchPos === -1) {
            continue;
        }
        const matchEnd = matchPos + segment.length;

        for (let i = 0; i < textDivs.length; i++) {
            const divStart = divStartInFull[i];
            const divEnd = divStart + divStripped[i].length;
            if (matchPos >= divEnd || matchEnd <= divStart) continue;

            const localStart = Math.max(0, matchPos - divStart);
            const localEnd = Math.min(
                divStripped[i].length,
                matchEnd - divStart,
            );
            divHighlightRanges.set(i, [localStart, localEnd]);
        }
    }

    if (divHighlightRanges.size === 0) return false;

    for (const [idx, [strStart, strEnd]] of divHighlightRanges) {
        const div = textDivs[idx];
        const orig = divOrigTexts[idx];

        // Map stripped positions back to original character positions
        const origStart = strippedPosToOriginal(orig, strStart);
        const origEnd = strippedPosToOriginal(orig, strEnd);

        div.setAttribute(ORIGINAL_TEXT_ATTR, orig);
        div.innerHTML =
            escapeHtml(orig.slice(0, origStart)) +
            `<span class="${HIGHLIGHT_CLASS}">${escapeHtml(orig.slice(origStart, origEnd))}</span>` +
            escapeHtml(orig.slice(origEnd));
    }

    return true;
}
