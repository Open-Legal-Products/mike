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

/**
 * Expand an IPv6 literal (possibly using `::` compression and/or a trailing
 * dotted-quad IPv4 tail) into its eight 16-bit groups. Returns null if the
 * input is not a well-formed IPv6 literal. Any embedded dotted IPv4 tail is
 * folded into the final two hextets so callers can read the embedded address
 * uniformly.
 */
function expandIpv6Groups(ip: string): number[] | null {
    let s = ip.toLowerCase();
    const zone = s.indexOf("%");
    if (zone !== -1) s = s.slice(0, zone);

    // Fold a trailing dotted-quad IPv4 tail (e.g. `::ffff:1.2.3.4`) into two
    // hex groups so the address is a pure list of hextets.
    const dotted = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (dotted) {
        const octets = dotted.slice(1, 5).map((o) => Number.parseInt(o, 10));
        if (octets.some((o) => o > 255)) return null;
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        s = s.slice(0, dotted.index) + `${hi}:${lo}`;
    }

    const halves = s.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

    let groups: string[];
    if (halves.length === 2) {
        const fill = 8 - head.length - tail.length;
        if (fill < 0) return null;
        groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
    } else {
        groups = head;
    }
    if (groups.length !== 8) return null;

    const nums = groups.map((g) => Number.parseInt(g || "0", 16));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) {
        return null;
    }
    return nums;
}

function embeddedIpv4(hi: number, lo: number): string {
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    // Link-local fe80::/10 — the first hextet ranges fe80..febf (four hex
    // digits). The narrower /^fe[89ab]:/ form was a bug: it only matched the
    // unrelated hextet "fe8:" and let fe80::1 through.
    if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;

    const groups = expandIpv6Groups(normalized);
    if (!groups) return false;

    // IPv4-mapped ::ffff:0:0/96 — covers both dotted (`::ffff:1.2.3.4`) and
    // hex (`::ffff:c0a8:0001`) forms. The address *is* the embedded IPv4.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        return isPrivateIpv4(embeddedIpv4(groups[6], groups[7]));
    }
    // NAT64 well-known prefix 64:ff9b::/96 — last 32 bits are the target IPv4.
    if (
        groups[0] === 0x64 &&
        groups[1] === 0xff9b &&
        groups[2] === 0 &&
        groups[3] === 0 &&
        groups[4] === 0 &&
        groups[5] === 0
    ) {
        return isPrivateIpv4(embeddedIpv4(groups[6], groups[7]));
    }
    // 6to4 2002::/16 — the embedded IPv4 sits in the second and third hextets.
    if (groups[0] === 0x2002) {
        return isPrivateIpv4(embeddedIpv4(groups[1], groups[2]));
    }
    return false;
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
