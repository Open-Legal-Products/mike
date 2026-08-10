export function getEditKey(messageId: string, editIndex: number): string {
  return `${messageId}:edit-${editIndex}`;
}
