import crypto from "crypto";

function getSecret(): string {
    return (
        process.env.DOWNLOAD_SIGNING_SECRET ??
        process.env.SUPABASE_SECRET_KEY ??
        "dev-secret"
    );
}

function b64urlEncode(buf: Buffer): string {
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function b64urlDecode(s: string): Buffer {
    let t = s.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    return Buffer.from(t, "base64");
}

function timingSafeEqStr(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function signLocalFile(
    key: string,
    filename: string,
    expiresIn: number,
): string {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const payload = JSON.stringify({ p: key, f: filename, exp });
    const enc = b64urlEncode(Buffer.from(payload, "utf8"));
    const sig = crypto
        .createHmac("sha256", getSecret())
        .update(enc)
        .digest();
    return `${enc}.${b64urlEncode(sig)}`;
}

export function verifyLocalFile(
    token: string,
): { key: string; filename: string } | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [enc, sigEnc] = parts;
    const expected = crypto
        .createHmac("sha256", getSecret())
        .update(enc)
        .digest();
    if (!timingSafeEqStr(sigEnc, b64urlEncode(expected))) return null;
    try {
        const parsed = JSON.parse(b64urlDecode(enc).toString("utf8")) as {
            p: string;
            f: string;
            exp: number;
        };
        if (!parsed?.p || !parsed?.f || !parsed?.exp) return null;
        if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
        return { key: parsed.p, filename: parsed.f };
    } catch {
        return null;
    }
}
