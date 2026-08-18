import { parseAskInputsResponsePayload } from "./contextBuilders";
import {
  MAX_ASK_INPUT_CHOICE_LENGTH,
  MAX_ASK_INPUT_TEXT_LENGTH,
  type AskInputsResponseRequest,
  type ChatMessage,
} from "./types";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; detail: string };

export type ChatDocumentReference = {
  filename: string;
  document_id: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseNonEmptyString(
  value: unknown,
  detail: string,
): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, detail };
  }
  return { ok: true, value: value.trim() };
}

export function parseOptionalProjectId(
  value: unknown,
): ValidationResult<{ provided: boolean; projectId: string | null }> {
  if (value === undefined) {
    return { ok: true, value: { provided: false, projectId: null } };
  }
  if (value === null) {
    return { ok: true, value: { provided: true, projectId: null } };
  }
  const parsed = parseNonEmptyString(
    value,
    "project_id must be a non-empty string or null",
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: { provided: true, projectId: parsed.value },
  };
}

export function parseOptionalChatId(
  value: unknown,
): ValidationResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  return parseNonEmptyString(value, "chat_id must be a non-empty string");
}

export function parseOptionalModel(
  value: unknown,
): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return parseNonEmptyString(value, "model must be a non-empty string");
}

function parseMessageFiles(
  value: unknown,
  messageIndex: number,
): ValidationResult<NonNullable<ChatMessage["files"]>> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      detail: `messages[${messageIndex}].files must be an array`,
    };
  }

  const files: NonNullable<ChatMessage["files"]> = [];
  for (const [fileIndex, file] of value.entries()) {
    if (!isRecord(file)) {
      return {
        ok: false,
        detail: `messages[${messageIndex}].files[${fileIndex}] must be an object`,
      };
    }
    const filename = parseNonEmptyString(
      file.filename,
      `messages[${messageIndex}].files[${fileIndex}].filename must be a non-empty string`,
    );
    if (!filename.ok) return filename;

    let documentId: string | undefined;
    if (file.document_id !== undefined) {
      const parsedDocumentId = parseNonEmptyString(
        file.document_id,
        `messages[${messageIndex}].files[${fileIndex}].document_id must be a non-empty string`,
      );
      if (!parsedDocumentId.ok) return parsedDocumentId;
      documentId = parsedDocumentId.value;
    }

    let versionId: string | undefined;
    if (file.version_id !== undefined) {
      const parsedVersionId = parseNonEmptyString(
        file.version_id,
        `messages[${messageIndex}].files[${fileIndex}].version_id must be a non-empty string`,
      );
      if (!parsedVersionId.ok) return parsedVersionId;
      versionId = parsedVersionId.value;
    }

    let versionNumber: number | undefined;
    if (file.version_number !== undefined) {
      if (
        typeof file.version_number !== "number" ||
        !Number.isInteger(file.version_number) ||
        file.version_number < 1
      ) {
        return {
          ok: false,
          detail: `messages[${messageIndex}].files[${fileIndex}].version_number must be a positive integer`,
        };
      }
      versionNumber = file.version_number;
    }

    files.push({
      filename: filename.value,
      ...(documentId ? { document_id: documentId } : {}),
      ...(versionId ? { version_id: versionId } : {}),
      ...(versionNumber !== undefined ? { version_number: versionNumber } : {}),
    });
  }
  return { ok: true, value: files };
}

function parseMessageWorkflow(
  value: unknown,
  messageIndex: number,
): ValidationResult<NonNullable<ChatMessage["workflow"]>> {
  if (!isRecord(value)) {
    return {
      ok: false,
      detail: `messages[${messageIndex}].workflow must be an object`,
    };
  }
  const id = parseNonEmptyString(
    value.id,
    `messages[${messageIndex}].workflow.id must be a non-empty string`,
  );
  if (!id.ok) return id;
  const title = parseNonEmptyString(
    value.title,
    `messages[${messageIndex}].workflow.title must be a non-empty string`,
  );
  if (!title.ok) return title;
  return { ok: true, value: { id: id.value, title: title.value } };
}

export function parseChatMessages(
  value: unknown,
): ValidationResult<ChatMessage[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, detail: "messages must be a non-empty array" };
  }

  const messages: ChatMessage[] = [];
  for (const [index, message] of value.entries()) {
    if (!isRecord(message)) {
      return {
        ok: false,
        detail: `messages[${index}] must be an object`,
      };
    }

    const role = typeof message.role === "string" ? message.role.trim() : "";
    if (role !== "user" && role !== "assistant") {
      return {
        ok: false,
        detail: `messages[${index}].role must be "user" or "assistant"`,
      };
    }
    if (message.content !== null && typeof message.content !== "string") {
      return {
        ok: false,
        detail: `messages[${index}].content must be a string or null`,
      };
    }

    let files: ChatMessage["files"];
    if (message.files !== undefined) {
      const parsedFiles = parseMessageFiles(message.files, index);
      if (!parsedFiles.ok) return parsedFiles;
      files = parsedFiles.value;
    }

    let workflow: ChatMessage["workflow"];
    if (message.workflow !== undefined) {
      const parsedWorkflow = parseMessageWorkflow(message.workflow, index);
      if (!parsedWorkflow.ok) return parsedWorkflow;
      workflow = parsedWorkflow.value;
    }

    messages.push({
      role,
      content: message.content,
      ...(files ? { files } : {}),
      ...(workflow ? { workflow } : {}),
    });
  }

  return { ok: true, value: messages };
}

function parseDocumentReference(
  value: unknown,
  field: string,
): ValidationResult<ChatDocumentReference> {
  if (!isRecord(value)) {
    return { ok: false, detail: `${field} must be an object` };
  }
  const filename = parseNonEmptyString(
    value.filename,
    `${field}.filename must be a non-empty string`,
  );
  if (!filename.ok) return filename;
  const documentId = parseNonEmptyString(
    value.document_id,
    `${field}.document_id must be a non-empty string`,
  );
  if (!documentId.ok) return documentId;
  return {
    ok: true,
    value: { filename: filename.value, document_id: documentId.value },
  };
}

export function parseOptionalDisplayedDoc(
  value: unknown,
): ValidationResult<ChatDocumentReference | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  return parseDocumentReference(value, "displayed_doc");
}

export function parseOptionalAttachedDocuments(
  value: unknown,
): ValidationResult<ChatDocumentReference[] | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      detail: "attached_documents must be an array",
    };
  }

  const documents: ChatDocumentReference[] = [];
  for (const [index, document] of value.entries()) {
    const parsed = parseDocumentReference(
      document,
      `attached_documents[${index}]`,
    );
    if (!parsed.ok) return parsed;
    documents.push(parsed.value);
  }
  return { ok: true, value: documents };
}

export function parseOptionalAskInputsResponse(
  value: unknown,
): ValidationResult<AskInputsResponseRequest | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(value)) {
    return {
      ok: false,
      detail: "ask_inputs_response must be an object",
    };
  }
  if (!Array.isArray(value.responses) || value.responses.length === 0) {
    return {
      ok: false,
      detail: "ask_inputs_response.responses must be a non-empty array",
    };
  }

  for (const [index, response] of value.responses.entries()) {
    const field = `ask_inputs_response.responses[${index}]`;
    if (!isRecord(response)) {
      return { ok: false, detail: `${field} must be an object` };
    }
    const id = parseNonEmptyString(
      response.id,
      `${field}.id must be a non-empty string`,
    );
    if (!id.ok) return id;
    if (
      response.kind !== "choice" &&
      response.kind !== "text" &&
      response.kind !== "documents"
    ) {
      return {
        ok: false,
        detail: `${field}.kind must be "choice", "text", or "documents"`,
      };
    }
    if (
      response.skipped !== undefined &&
      typeof response.skipped !== "boolean"
    ) {
      return { ok: false, detail: `${field}.skipped must be a boolean` };
    }

    if (response.kind === "choice" || response.kind === "text") {
      const question = parseNonEmptyString(
        response.question,
        `${field}.question must be a non-empty string`,
      );
      if (!question.ok) return question;
      if (
        response.answer !== undefined &&
        typeof response.answer !== "string"
      ) {
        return { ok: false, detail: `${field}.answer must be a string` };
      }
      if (
        response.skipped !== true &&
        (typeof response.answer !== "string" || !response.answer.trim())
      ) {
        return {
          ok: false,
          detail: `${field}.answer must be a non-empty string unless skipped`,
        };
      }
      // Both answer kinds are capped here, at the same limits the
      // persistence layer truncates to. Without the choice cap, an
      // oversized choice answer is accepted, echoed into this turn's
      // prompt in full, and only silently shortened when it is stored
      // and replayed — so the model sees one answer now and a
      // different one later.
      const maxAnswerLength =
        response.kind === "text"
          ? MAX_ASK_INPUT_TEXT_LENGTH
          : MAX_ASK_INPUT_CHOICE_LENGTH;
      if (
        typeof response.answer === "string" &&
        response.answer.length > maxAnswerLength
      ) {
        return {
          ok: false,
          detail: `${field}.answer must be at most ${maxAnswerLength} characters`,
        };
      }
      continue;
    }

    if (!Array.isArray(response.filenames)) {
      return { ok: false, detail: `${field}.filenames must be an array` };
    }
    for (const [filenameIndex, filename] of response.filenames.entries()) {
      const parsedFilename = parseNonEmptyString(
        filename,
        `${field}.filenames[${filenameIndex}] must be a non-empty string`,
      );
      if (!parsedFilename.ok) return parsedFilename;
    }
  }

  // Shape validation above makes the existing normalizer safe to call while
  // preserving its established length and item-count limits.
  const response = parseAskInputsResponsePayload(value);
  if (!response) {
    return {
      ok: false,
      detail: "ask_inputs_response must contain at least one valid response",
    };
  }
  return { ok: true, value: response };
}
