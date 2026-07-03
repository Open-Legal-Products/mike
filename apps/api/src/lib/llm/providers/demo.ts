/**
 * Demo provider — a built-in, keyless model that returns a canned but
 * context-aware placeholder answer.
 *
 * Why this exists: a brand-new instance (or a self-hoster who hasn't added a
 * key yet) would otherwise hit a raw provider auth error on their very first
 * question. There is no reliable free hosted LLM we can call without a key, so
 * instead of failing we answer locally in "demo mode": we acknowledge the
 * question and any shared documents, describe what a real model would do, and
 * point the user at Settings → API Keys. No network call, no key required, so
 * it works offline and in air-gapped mode too.
 *
 * Registered unconditionally by registerBuiltinProviders(). The chat route also
 * routes to DEMO_MODEL automatically when the chosen provider has no configured
 * key (see chat.routes.ts).
 */

import { registerProvider } from "../registry";
import { registerApiKeyProvider } from "../../../core/apiKeyProviders";
import { DEMO_MODEL } from "../models";
import type {
    StreamChatParams,
    StreamChatResult,
    CompleteTextParams,
} from "../types";

// Match filename-looking tokens (no spaces, so we don't swallow surrounding
// prose like "…terms in nda.pdf").
const FILENAME_RE = /\b[\w()\-]+\.(?:pdf|docx?|txt|md|csv)\b/gi;

/** Pull any document filenames mentioned in the prompt so the demo reply can
 *  name what the user shared. Best-effort — returns [] when nothing matches. */
function extractSharedDocuments(params: StreamChatParams): string[] {
    const haystack = [
        params.systemPrompt ?? "",
        ...params.messages.map((m) => m.content ?? ""),
    ].join("\n");
    const found = new Set<string>();
    for (const match of haystack.matchAll(FILENAME_RE)) {
        const name = match[0].trim();
        // Skip absurdly long "filenames" that are really prose containing a dot.
        if (name.length <= 80) found.add(name);
    }
    return [...found];
}

function lastUserQuestion(params: StreamChatParams): string {
    for (let i = params.messages.length - 1; i >= 0; i--) {
        if (params.messages[i].role === "user") {
            return (params.messages[i].content ?? "").trim();
        }
    }
    return "";
}

/** Build the demo answer. Kept deterministic and clearly labelled so no one
 *  mistakes it for real legal analysis. */
export function buildDemoAnswer(params: StreamChatParams): string {
    const question = lastUserQuestion(params);
    const docs = extractSharedDocuments(params);

    const lines: string[] = [];
    lines.push(
        "**Demo mode** — no AI provider key is configured, so Mike is replying with a placeholder instead of real analysis.",
    );
    lines.push("");
    if (question) {
        const trimmed =
            question.length > 300 ? `${question.slice(0, 300)}…` : question;
        lines.push(`You asked: *"${trimmed}"*`);
        lines.push("");
    }
    if (docs.length > 0) {
        const list = docs.slice(0, 8).join(", ");
        lines.push(
            `You've shared **${docs.length} document${docs.length === 1 ? "" : "s"}** (${list}). ` +
                "With a configured model, Mike would read them in full and extract the parties, governing law, " +
                "key dates, obligations, payment and liability terms, and flag risks — each answer cited back to the " +
                "exact source text.",
        );
    } else {
        lines.push(
            "With a configured model, Mike answers questions about your uploaded documents — extracting parties, " +
                "governing law, key dates, obligations and risks, with every answer cited back to the source text.",
        );
    }
    lines.push("");
    lines.push("**To get real answers:**");
    lines.push("1. Open **Settings → API Keys**");
    lines.push(
        "2. Add an Anthropic, Google, or OpenAI key — or point Mike at a local model",
    );
    lines.push("3. Re-send your question");
    lines.push("");
    lines.push(
        "_Your documents stay in your workspace — nothing is sent to an AI provider until you add a key._",
    );
    return lines.join("\n");
}

/** Emit `text` through onContentDelta in small chunks so the UI renders it as a
 *  normal streamed answer. Honours the abort signal. */
async function streamDemoText(
    text: string,
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const signal = params.signal ?? params.abortSignal;
    const onDelta = params.callbacks?.onContentDelta;
    if (!onDelta) return { fullText: text };

    // Chunk on word boundaries; keep the whitespace attached to each token.
    const tokens = text.match(/\S+\s*/g) ?? [text];
    for (const token of tokens) {
        if (signal?.aborted) break;
        onDelta(token);
    }
    return { fullText: text };
}

export function setupDemo(): void {
    // No credentials required. Registering with an empty env-var list keeps the
    // provider out of "server key configured" accounting without needing a key.
    registerApiKeyProvider("demo", []);

    registerProvider({
        id: "demo",
        matchesModel: (m) => m === DEMO_MODEL,
        stream: (params: StreamChatParams) =>
            streamDemoText(buildDemoAnswer(params), params),
        complete: async (params: CompleteTextParams) => {
            // Used for lightweight jobs (e.g. title generation). Return a short,
            // safe string rather than a paragraph.
            return params.user.trim().slice(0, 60) || "Demo chat";
        },
        models: { main: [DEMO_MODEL], mid: [], low: [] },
    });
}
