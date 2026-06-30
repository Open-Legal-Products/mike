const SECRET_CONTEXT_PATTERNS = [
  /(Incorrect API key provided:\s*)([^.\s]+)(\.?)/gi,
  /(api[_ -]?key|x-api-key|token|secret|authorization|bearer)\s*(?:provided\s*)?(?:is|:|=)\s*["']?([A-Za-z0-9._\-]{6,})["']?/gi,
];

const PROVIDER_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_\-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_\-]{12,}\b/g,
  /\bsk-or-[A-Za-z0-9_\-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_\-]{20,}\b/g,
];

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_CONTEXT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...groups: string[]) => {
      if (match.toLowerCase().startsWith("incorrect api key provided:")) {
        return `${groups[0]}[redacted]${groups[2] ?? ""}`;
      }
      const secret = groups[1];
      return secret ? match.replace(secret, "[redacted]") : match;
    });
  }
  for (const pattern of PROVIDER_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

export function safeErrorMessage(
  error: unknown,
  fallback = "Unexpected error",
): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  return redactSensitiveText(message);
}

export function safeErrorLog(error: unknown): {
  name: string | null;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name || null,
      message: redactSensitiveText(error.message || "Unexpected error"),
      stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    };
  }
  return {
    name: null,
    message: safeErrorMessage(error),
  };
}
