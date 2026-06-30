import net from "net";

/**
 * SSRF guard helpers: classify an IP literal as private/reserved/unsafe.
 * Shared by the MCP connector egress check and the OpenAI base-URL validation
 * so both reject the same ranges. Conservative: anything unparseable or
 * unrecognized is treated as blocked.
 */
export function isPrivateIpv4(ip: string): boolean {
    const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
        return true;
    }
    const [a, b] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

export function isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]:/.test(normalized)) return true;
    const ipv4Tail = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return ipv4Tail ? isPrivateIpv4(ipv4Tail[1]) : false;
}

/**
 * True if `ip` is a private/reserved/unsafe address. Non-IP input returns true
 * (fail closed) — callers should pass resolved IP literals.
 */
export function isBlockedIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIpv4(ip);
    if (family === 6) return isPrivateIpv6(ip);
    return true;
}
