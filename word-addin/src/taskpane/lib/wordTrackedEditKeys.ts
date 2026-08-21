export function getEditKey(messageId: string, editIndex: number): string {
  return `${messageId}:edit-${editIndex}`;
}

export function parseEditKey(
  key: string,
): { messageId: string; blockIndex: number } | null {
  const marker = ":edit-";
  const markerIndex = key.lastIndexOf(marker);
  if (markerIndex <= 0) return null;
  const blockIndexText = key.slice(markerIndex + marker.length);
  if (!/^(0|[1-9]\d*)$/.test(blockIndexText)) return null;
  return {
    messageId: key.slice(0, markerIndex),
    blockIndex: Number(blockIndexText),
  };
}

/**
 * First block index a tool-proposed edit (apply_word_edits) may claim.
 *
 * Streamed <EDITS> blocks number from 0 upward within a message. Tool edits
 * start here so the two channels can never collide two different edits onto
 * one card key — or onto one (message_id, block_index) row. The backend
 * counts from the same base (TOOL_EDIT_BLOCK_INDEX_BASE in
 * backend/src/lib/chat/tools/wordClientTools.ts) and forwards its first
 * ordinal with each call, so a divergence surfaces instead of corrupting a
 * card.
 *
 * It stays well under the edit routes' 10_000 block-index ceiling, which is
 * what lets tool edits persist through the same PUT/PATCH endpoints and
 * restore through the same message.edits path as streamed ones.
 */
export const TOOL_EDIT_INDEX_BASE = 1_000;

export function getToolEditKey(messageId: string, ordinal: number): string {
  return getEditKey(messageId, TOOL_EDIT_INDEX_BASE + ordinal);
}

/** True for a block index the tool channel produced. */
export function isToolEditBlockIndex(blockIndex: number): boolean {
  return blockIndex >= TOOL_EDIT_INDEX_BASE;
}
