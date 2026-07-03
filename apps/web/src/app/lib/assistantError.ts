/**
 * Maps raw assistant/provider error strings (e.g. "Gemini error (400): API key
 * not valid. Please pass a valid API key.", "Claude error
 * (authentication_error): invalid x-api-key") to neutral, branded copy that is
 * safe and helpful to show a user. The raw string is preserved separately so it
 * can be attached to a support email — it is never shown in the UI.
 */

export type AssistantErrorCategory =
    | "auth"
    | "rate_limit"
    | "safety"
    | "network"
    | "unknown";

export interface FriendlyAssistantError {
    /** User-facing message — no provider names, HTTP codes, or header names. */
    message: string;
    /** Category, for analytics / conditional UI. */
    category: AssistantErrorCategory;
    /** The original error string, for the support email body only. */
    raw: string;
}

const RULES: {
    category: AssistantErrorCategory;
    test: RegExp;
    message: string;
}[] = [
    {
        category: "auth",
        test: /api[\s_-]?key|x-api-key|authentication|unauthor|invalid[\s_-]?key|401|403/i,
        message:
            "This model isn't set up correctly — its API key is missing or invalid. Add a working key in Settings → API Keys, or switch to the demo model.",
    },
    {
        category: "rate_limit",
        test: /rate[\s_-]?limit|429|quota|overloaded|too many requests|capacity|529/i,
        message:
            "The AI provider is busy or rate-limited right now. Please wait a moment and try again.",
    },
    {
        category: "safety",
        test: /safety|blocked|content policy|policy violation|refus|moderation/i,
        message:
            "The model declined to answer this request. Try rephrasing your question.",
    },
    {
        category: "network",
        test: /timeout|timed out|network|fetch failed|econn|socket|connection|502|503|504/i,
        message:
            "The connection to the AI provider was interrupted. Please try again.",
    },
];

export function sanitizeAssistantError(raw: unknown): FriendlyAssistantError {
    const text =
        typeof raw === "string" && raw.trim() ? raw.trim() : "Unknown error";
    for (const rule of RULES) {
        if (rule.test.test(text)) {
            return { message: rule.message, category: rule.category, raw: text };
        }
    }
    return {
        message:
            "Something went wrong while generating a response. Please try again.",
        category: "unknown",
        raw: text,
    };
}

const SUPPORT_EMAIL = "support@mikeoss.com";

/**
 * Build a mailto: link that pre-fills a bug report with useful context. Called
 * from the error UI's "Report to support" action.
 */
export function buildSupportMailto(opts: {
    error: FriendlyAssistantError;
    model?: string;
    chatId?: string;
}): string {
    const { error, model, chatId } = opts;
    const subject = `Mike bug report: ${error.category} error`;
    const body = [
        "Hi Mike support,",
        "",
        "I hit an error while using the assistant. Details below:",
        "",
        `• What happened: ${error.message}`,
        `• Category: ${error.category}`,
        model ? `• Model: ${model}` : null,
        chatId ? `• Chat ID: ${chatId}` : null,
        `• Technical detail: ${error.raw}`,
        typeof window !== "undefined" ? `• Page: ${window.location.href}` : null,
        "",
        "What I was trying to do:",
        "",
    ]
        .filter((l) => l !== null)
        .join("\n");
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        subject,
    )}&body=${encodeURIComponent(body)}`;
}
