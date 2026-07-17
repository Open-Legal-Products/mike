/**
 * Convert model-authored Markdown-ish text into document text that Word can
 * place without leaking chat formatting tokens into a legal document.
 *
 * This is intentionally conservative: it preserves wording, numbering and
 * paragraph boundaries, but removes presentation-only Markdown. Word then
 * applies the surrounding document's paragraph formatting during insertion.
 */
export function toWordParagraphs(value: string): string[] {
  let text = value.replace(/\r\n?/g, "\n").trim();

  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();

  const paragraphs: string[] = [];
  let previousWasBlank = false;

  for (const sourceLine of text.split("\n")) {
    const trimmed = sourceLine.trim();
    if (!trimmed) {
      if (paragraphs.length > 0 && !previousWasBlank) paragraphs.push("");
      previousWasBlank = true;
      continue;
    }

    // Markdown table divider rows are presentation syntax, not content.
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) {
      continue;
    }

    let line = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "• ")
      .replace(/^\|(.+)\|$/, (_match, cells: string) =>
        cells
          .split("|")
          .map((cell) => cell.trim())
          .join("\t")
      )
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();

    if (line) paragraphs.push(line);
    previousWasBlank = false;
  }

  while (paragraphs.at(-1) === "") paragraphs.pop();
  return paragraphs;
}

export function toWordText(value: string): string {
  return toWordParagraphs(value).join("\n");
}
