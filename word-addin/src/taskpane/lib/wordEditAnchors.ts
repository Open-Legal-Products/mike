/// <reference types="office-js" />

/**
 * Document-local registry for durable Word edit anchors.
 *
 * The stable edit ID comes from the persisted assistant-message UUID plus the
 * redline block index. The bookmark itself lives in Word; this setting tells a
 * reloaded task pane which bookmark belongs to which historical edit card.
 */
const WORD_EDIT_ANCHORS_SETTING = "mike.wordEditAnchors.v1";

interface WordEditAnchor {
  bookmarkName: string;
  createdAt: string;
}

interface PersistedWordEditAnchorRegistry {
  version: 1;
  anchors: Record<string, WordEditAnchor>;
}

const EMPTY_REGISTRY: PersistedWordEditAnchorRegistry = {
  version: 1,
  anchors: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRegistry(
  settings: Office.Settings
): PersistedWordEditAnchorRegistry {
  const value = settings.get(WORD_EDIT_ANCHORS_SETTING) as unknown;
  if (!isPlainObject(value) || value.version !== 1 || !isPlainObject(value.anchors)) {
    return { ...EMPTY_REGISTRY, anchors: {} };
  }

  const anchors: Record<string, WordEditAnchor> = {};
  for (const [stableEditId, candidate] of Object.entries(value.anchors)) {
    const expectedBookmarkName = bookmarkNameForEdit(stableEditId);
    if (
      isPlainObject(candidate) &&
      candidate.bookmarkName === expectedBookmarkName &&
      typeof candidate.createdAt === "string"
    ) {
      anchors[stableEditId] = {
        bookmarkName: candidate.bookmarkName,
        createdAt: candidate.createdAt,
      };
    }
  }
  return { version: 1, anchors };
}

function saveSettings(settings: Office.Settings): Promise<void> {
  return new Promise((resolve, reject) => {
    settings.saveAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve();
        return;
      }
      reject(new Error(result.error?.message || "Word could not save edit anchors."));
    });
  });
}

/** A compact deterministic digest using two independent 32-bit FNV-1a passes. */
function stableDigest(value: string): string {
  const hash = (seed: number): string => {
    let result = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

/**
 * Word bookmark names are limited to 40 alphanumeric/underscore characters.
 * Leading `_` makes this an invisible bookmark in Word's normal bookmark UI.
 */
export function bookmarkNameForEdit(stableEditId: string): string {
  return `_MikeEdit_${stableDigest(stableEditId)}`;
}

export function getWordEditAnchor(stableEditId: string): WordEditAnchor | null {
  const settings = Office.context.document.settings;
  const anchor = readRegistry(settings).anchors[stableEditId];
  return anchor ? { ...anchor } : null;
}

export async function persistWordEditAnchor(
  stableEditId: string,
  bookmarkName: string
): Promise<void> {
  if (bookmarkName !== bookmarkNameForEdit(stableEditId)) {
    throw new Error("Word edit anchor name does not match its stable edit ID.");
  }
  const settings = Office.context.document.settings;
  const registry = readRegistry(settings);
  registry.anchors[stableEditId] = {
    bookmarkName,
    createdAt: new Date().toISOString(),
  };
  settings.set(WORD_EDIT_ANCHORS_SETTING, registry);
  await saveSettings(settings);
}

export async function removeWordEditAnchor(stableEditId: string): Promise<void> {
  const settings = Office.context.document.settings;
  const rawRegistry = settings.get(WORD_EDIT_ANCHORS_SETTING) as unknown;
  const rawContainsAnchor =
    isPlainObject(rawRegistry) &&
    isPlainObject(rawRegistry.anchors) &&
    Object.prototype.hasOwnProperty.call(rawRegistry.anchors, stableEditId);
  const registry = readRegistry(settings);
  if (!registry.anchors[stableEditId] && !rawContainsAnchor) return;

  delete registry.anchors[stableEditId];
  if (Object.keys(registry.anchors).length === 0) {
    settings.remove(WORD_EDIT_ANCHORS_SETTING);
  } else {
    settings.set(WORD_EDIT_ANCHORS_SETTING, registry);
  }
  await saveSettings(settings);
}
