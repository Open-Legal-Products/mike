/**
 * Parse model-proposed edits out of a streamed completion so they can be
 * applied to the document as tracked changes.
 *
 * The Word-chat system prompt instructs the model to report each proposed edit
 * as an <original> / <replacement> / <reason> block. The task pane treats that
 * format as a transport protocol: it projects partial blocks directly into
 * edit cards, hides the raw markers, and emits exact edits only at safe block
 * boundaries for Word's search API.
 */

export interface RedlineEdit {
  /** Exact text to locate in the document (verbatim, case-sensitive). */
  original: string;
  /** Text to put in its place. */
  replacement: string;
  /** Model's one-line justification; display-only. */
  reason?: string;
}

/**
 * A redline block projected from a response that may still be streaming.
 *
 * `replacement` remains optional so the UI can render an original-only card
 * while the replacement field is still arriving. `sealed` is deliberately
 * stricter than "has enough fields to render": it is true only after a legacy
 * block boundary has arrived, or all three closing tags have arrived for the
 * tagged protocol. Only sealed edits are safe to apply to Word.
 */
export interface StreamingRedlineEdit {
  /** Stable ordinal in the raw protocol, including duplicate blocks. */
  blockIndex: number;
  original: string;
  replacement?: string;
  reason?: string;
  sealed: boolean;
}

interface RedlineStreamProjection {
  /** Response prose with protocol fields and their continuations removed. */
  visibleProse: string;
  /** Complete and provisional edit cards, in response order. */
  edits: StreamingRedlineEdit[];
  /** The sealed subset, shaped for `applyTrackedEdits`. */
  safeEdits: RedlineEdit[];
  /** True even when only a partial trailing marker such as `<ori` has arrived. */
  protocolStarted: boolean;
}

type FieldName = "original" | "replacement" | "reason";

// Tolerates list numbering ("1. ORIGINAL:") and Markdown bold ("**ORIGINAL:**")
// in case the model decorates the mandated format.
const FIELD_LINE =
  /^\s*(?:\d+[.)]\s*)?\*{0,2}(ORIGINAL|REPLACEMENT|REASON)\*{0,2}\s*:\s*(.*)$/;

const FIELD_NAMES = ["ORIGINAL", "REPLACEMENT", "REASON"] as const;

/**
 * Detect the unfinished tail of a protocol marker. Streaming transports can
 * split at any character, so waiting for the colon would briefly expose text
 * such as `ORIG` or `**REPLACEM` in the answer. Exact field lines are handled
 * by FIELD_LINE; this helper only recognizes a marker with no value yet.
 */
function isPartialFieldLine(line: string): boolean {
  let candidate = line.trimStart();
  candidate = candidate.replace(/^\d+[.)]\s+/, "");
  candidate = candidate.replace(/^\*{1,2}/, "");
  if (!candidate) return false;

  return FIELD_NAMES.some((field) => {
    if (field.startsWith(candidate)) return true;
    if (!candidate.startsWith(field)) return false;
    const markerSuffix = candidate.slice(field.length);
    return /^\*{0,2}\s*:?\s*$/.test(markerSuffix);
  });
}

interface MutableStreamingBlock {
  original?: string;
  replacement?: string;
  reason?: string;
  boundaryReached: boolean;
}

/**
 * Project a response-in-progress into prose and edit cards without ever
 * displaying the raw ORIGINAL / REPLACEMENT / REASON transport protocol.
 *
 * A block becomes sealed when a blank separator or the next ORIGINAL marker
 * arrives. The final block is intentionally provisional while streaming,
 * even if it already contains ORIGINAL and REPLACEMENT; pass
 * `streamComplete=true` only after the response has ended to seal that tail.
 */
function projectLegacyRedlineStream(
  text: string,
  streamComplete = false,
): RedlineStreamProjection {
  const visibleLines: string[] = [];
  const blocks: MutableStreamingBlock[] = [];
  let current: MutableStreamingBlock | null = null;
  let lastField: FieldName | null = null;
  let protocolStarted = false;

  const flush = (boundaryReached: boolean): void => {
    if (current) {
      blocks.push({ ...current, boundaryReached });
    }
    current = null;
    lastField = null;
  };

  const lines = text.split(/\r?\n/);
  const hasOpenTrailingLine = /\r?\n$/.test(text);

  lines.forEach((line, index) => {
    const match = line.match(FIELD_LINE);
    if (match) {
      const fieldName = match[1];
      const fieldValue = match[2];
      if (!fieldName || fieldValue === undefined) return;
      protocolStarted = true;
      const field = fieldName.toLowerCase() as FieldName;
      if (field === "original" && current) flush(true);
      current ??= { boundaryReached: false };
      current[field] = fieldValue;
      lastField = field;
      return;
    }

    if (isPartialFieldLine(line)) {
      protocolStarted = true;
      return;
    }

    if (!line.trim()) {
      // split("...\n") has an empty cursor line at the end. A single line
      // ending is not a blank block separator; a true blank separator produces
      // another empty element before this trailing cursor line.
      const isOpenCursorLine =
        hasOpenTrailingLine && index === lines.length - 1;
      if (isOpenCursorLine) return;

      if (current && lastField) flush(true);
      visibleLines.push(line);
      return;
    }

    if (current && lastField) {
      current[lastField] = `${current[lastField] ?? ""}\n${line.trim()}`;
      return;
    }

    visibleLines.push(line);
  });

  if (current) flush(streamComplete);

  const edits: StreamingRedlineEdit[] = [];
  const safeEdits: RedlineEdit[] = [];
  const seenSafeOriginals = new Set<string>();

  blocks.forEach((block, blockIndex) => {
    const original = block.original?.trim() ?? "";
    const replacement =
      block.replacement === undefined ? undefined : block.replacement.trim();
    const reason = block.reason?.trim();
    const sealed =
      block.boundaryReached && !!original && replacement !== undefined;

    // Never emit repeated actionable ORIGINALs: the second Word search would
    // run after the first replacement has already changed the document.
    if (sealed && seenSafeOriginals.has(original)) return;

    edits.push({
      blockIndex,
      original,
      ...(replacement !== undefined ? { replacement } : {}),
      ...(reason ? { reason } : {}),
      sealed,
    });

    if (sealed) {
      seenSafeOriginals.add(original);
      safeEdits.push({
        original,
        replacement,
        ...(reason ? { reason } : {}),
      });
    }
  });

  return {
    visibleProse: visibleLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    edits,
    safeEdits,
    protocolStarted,
  };
}

const COMPLETE_TAGGED_EDIT =
  /<original>([\s\S]*?)<\/original>\s*<replacement>([\s\S]*?)<\/replacement>\s*<reason>([\s\S]*?)<\/reason>/gi;
const ORIGINAL_OPEN = "<original>";

function normalizeVisibleProse(value: string): string {
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function partialTagStartAtEnd(text: string, tag: string): number {
  const lower = text.toLowerCase();
  for (let length = tag.length - 1; length >= 1; length -= 1) {
    if (lower.endsWith(tag.slice(0, length))) return text.length - length;
  }
  return -1;
}

function withoutPartialClosingTag(value: string, tag: string): string {
  const lower = value.toLowerCase();
  for (let length = tag.length - 1; length >= 1; length -= 1) {
    if (lower.endsWith(tag.slice(0, length))) {
      return value.slice(0, value.length - length);
    }
  }
  return value;
}

function parseProvisionalTaggedEdit(
  source: string,
  blockIndex: number,
): StreamingRedlineEdit {
  const lower = source.toLowerCase();
  const originalValueStart = ORIGINAL_OPEN.length;
  const originalClose = "</original>";
  const originalEnd = lower.indexOf(originalClose, originalValueStart);
  if (originalEnd < 0) {
    return {
      blockIndex,
      original: withoutPartialClosingTag(
        source.slice(originalValueStart),
        originalClose,
      ).trim(),
      sealed: false,
    };
  }

  const original = source.slice(originalValueStart, originalEnd).trim();
  let cursor = originalEnd + originalClose.length;
  const afterOriginal = source.slice(cursor).trimStart();
  cursor = source.length - afterOriginal.length;
  const replacementOpen = "<replacement>";
  if (!afterOriginal.toLowerCase().startsWith(replacementOpen)) {
    return { blockIndex, original, sealed: false };
  }

  const replacementValueStart = cursor + replacementOpen.length;
  const replacementClose = "</replacement>";
  const replacementEnd = lower.indexOf(replacementClose, replacementValueStart);
  if (replacementEnd < 0) {
    return {
      blockIndex,
      original,
      replacement: withoutPartialClosingTag(
        source.slice(replacementValueStart),
        replacementClose,
      ).trim(),
      sealed: false,
    };
  }

  const replacement = source
    .slice(replacementValueStart, replacementEnd)
    .trim();
  cursor = replacementEnd + replacementClose.length;
  const afterReplacement = source.slice(cursor).trimStart();
  cursor = source.length - afterReplacement.length;
  const reasonOpen = "<reason>";
  if (!afterReplacement.toLowerCase().startsWith(reasonOpen)) {
    return { blockIndex, original, replacement, sealed: false };
  }

  const reasonValueStart = cursor + reasonOpen.length;
  return {
    blockIndex,
    original,
    replacement,
    reason: withoutPartialClosingTag(
      source.slice(reasonValueStart),
      "</reason>",
    ).trim(),
    sealed: false,
  };
}

function hasTaggedProtocol(text: string): boolean {
  if (/<original>/i.test(text)) return true;
  return partialTagStartAtEnd(text, ORIGINAL_OPEN) >= 0;
}

function projectTaggedRedlineStream(text: string): RedlineStreamProjection {
  const edits: StreamingRedlineEdit[] = [];
  const safeEdits: RedlineEdit[] = [];
  const visibleParts: string[] = [];
  const seenSafeOriginals = new Set<string>();
  const matcher = new RegExp(COMPLETE_TAGGED_EDIT.source, "gi");
  let cursor = 0;
  let blockIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    visibleParts.push(text.slice(cursor, match.index));
    const original = (match[1] ?? "").trim();
    const replacement = (match[2] ?? "").trim();
    const reason = (match[3] ?? "").trim();
    if (original && !seenSafeOriginals.has(original)) {
      seenSafeOriginals.add(original);
      edits.push({
        blockIndex,
        original,
        replacement,
        ...(reason ? { reason } : {}),
        sealed: true,
      });
      safeEdits.push({
        original,
        replacement,
        ...(reason ? { reason } : {}),
      });
    }
    blockIndex += 1;
    cursor = matcher.lastIndex;
  }

  const tail = text.slice(cursor);
  const nextOriginal = tail.toLowerCase().indexOf(ORIGINAL_OPEN);
  if (nextOriginal >= 0) {
    visibleParts.push(tail.slice(0, nextOriginal));
    const provisional = parseProvisionalTaggedEdit(
      tail.slice(nextOriginal),
      blockIndex,
    );
    if (!provisional.original || !seenSafeOriginals.has(provisional.original)) {
      edits.push(provisional);
    }
  } else {
    const partialStart = partialTagStartAtEnd(tail, ORIGINAL_OPEN);
    visibleParts.push(partialStart >= 0 ? tail.slice(0, partialStart) : tail);
  }

  return {
    visibleProse: normalizeVisibleProse(visibleParts.join("")),
    edits,
    safeEdits,
    protocolStarted: true,
  };
}

// Single-entry projection memo. During a streamed answer the projection runs
// against the identical accumulated string several times per chunk (the edit
// controller once per delta, the message renderer once per re-render), and
// every call re-parses from index zero — O(n²) over a stream without this.
let lastProjectionText: string | null = null;
let lastProjectionComplete = false;
let lastProjection: RedlineStreamProjection | null = null;

/**
 * Project the current tagged edit stream into prose and edit cards. Legacy
 * label blocks remain supported so previously saved Word chats still load.
 */
export function projectRedlineStream(
  text: string,
  streamComplete = false,
): RedlineStreamProjection {
  if (
    lastProjection &&
    lastProjectionText === text &&
    lastProjectionComplete === streamComplete
  ) {
    return lastProjection;
  }
  const projection = hasTaggedProtocol(text)
    ? projectTaggedRedlineStream(text)
    : projectLegacyRedlineStream(text, streamComplete);
  lastProjectionText = text;
  lastProjectionComplete = streamComplete;
  lastProjection = projection;
  return projection;
}
