import { env } from "../env";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function isLocalHostname(hostname: string): boolean {
    return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local")
    );
}

export function resolveOpenAIBaseUrl(
    raw = env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    nodeEnv = env.NODE_ENV,
): string {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("OPENAI_BASE_URL must use http or https");
    }
    if (nodeEnv === "production" && parsed.protocol !== "https:") {
        throw new Error("OPENAI_BASE_URL must use https in production");
    }
    if (
        nodeEnv === "production" &&
        isLocalHostname(parsed.hostname) &&
        env.OPENAI_ALLOW_LOCAL_BASE_URL !== "true"
    ) {
        throw new Error(
            "OPENAI_BASE_URL cannot point at localhost in production unless OPENAI_ALLOW_LOCAL_BASE_URL=true",
        );
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
}

export function openAIResponsesUrl(baseUrl = resolveOpenAIBaseUrl()): string {
    return `${baseUrl}/responses`;
}
