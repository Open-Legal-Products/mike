import net from "net";
import { env } from "../env";
import { isBlockedIp } from "../privateIp";

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
    if (nodeEnv === "production" && env.OPENAI_ALLOW_LOCAL_BASE_URL !== "true") {
        // URL hostnames wrap IPv6 in brackets ([::1]); strip them for net.isIP.
        const host = parsed.hostname.replace(/^\[|\]$/g, "");
        if (isLocalHostname(parsed.hostname)) {
            throw new Error(
                "OPENAI_BASE_URL cannot point at localhost in production unless OPENAI_ALLOW_LOCAL_BASE_URL=true",
            );
        }
        // Reject IP literals in private/reserved ranges (SSRF) — parity with the
        // MCP egress guard. DNS hostnames are operator config, not resolved here.
        if (net.isIP(host) !== 0 && isBlockedIp(host)) {
            throw new Error(
                "OPENAI_BASE_URL cannot point at a private or reserved IP in production unless OPENAI_ALLOW_LOCAL_BASE_URL=true",
            );
        }
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
}

export function openAIResponsesUrl(baseUrl = resolveOpenAIBaseUrl()): string {
    return `${baseUrl}/responses`;
}
