/// <reference types="office-js" />
import { useEffect, useState } from "react";

const WORD_DOCUMENT_ID_SETTING = "mike.word.documentId.v1";

function makeUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === "x" ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}

function saveSettings(settings: Office.Settings): Promise<void> {
  return new Promise((resolve, reject) => {
    settings.saveAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
      else reject(new Error(result.error?.message || "Could not save the document ID."));
    });
  });
}

async function getOrCreateWordDocumentId(): Promise<string> {
  const settings = Office.context.document.settings;
  const existing = settings.get(WORD_DOCUMENT_ID_SETTING);
  if (typeof existing === "string" && existing.trim()) return existing;

  const documentId = makeUuid();
  settings.set(WORD_DOCUMENT_ID_SETTING, documentId);
  await saveSettings(settings);
  return documentId;
}

export function useWordDocumentIdentity(): {
  documentId: string | null;
  loading: boolean;
  error: string | null;
} {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOrCreateWordDocumentId()
      .then((id) => {
        if (!cancelled) setDocumentId(id);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not identify this Word document."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { documentId, loading, error };
}
