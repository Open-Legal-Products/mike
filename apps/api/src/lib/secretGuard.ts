// Fail the boot if the deployment is running on demo/placeholder secrets.
//
// env.ts validates shape/length; this adds a VALUE check that only runs for real
// deployments (AIRGAPPED or production): a self-hoster who copies the demo
// compose and forgets gen-secrets.sh must not silently ship the Supabase demo
// JWT secret + keys (which would let anyone forge a service_role token and
// bypass RLS entirely). See docs/SELF_HOSTING_AIRGAPPED_PLAN.md §10.

import crypto from "crypto";

const DEMO_JWT_SECRET =
    "super-secret-jwt-token-with-at-least-32-characters-long";
const PLACEHOLDER_PATTERNS = [
    /your-.*secret/i,
    /change[-_]?me/i,
    /placeholder/i,
    /example/i,
];

/** The `iss` claim of a JWT, or null if it can't be parsed. */
function jwtIssuer(token: string | undefined): string | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const json = Buffer.from(
            parts[1].replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
        ).toString("utf8");
        const iss = (JSON.parse(json) as { iss?: unknown }).iss;
        return typeof iss === "string" ? iss : null;
    } catch {
        return null;
    }
}

/** True if `token` is a well-formed HS256 JWT signed by `secret`. */
function jwtSignedBy(token: string | undefined, secret: string): boolean {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const b64url = (b: Buffer) =>
        b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const expected = b64url(
        crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest(),
    );
    const a = Buffer.from(parts[2]);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Throw (listing every problem) if a real deployment is using demo or
 * placeholder secrets. No-op in dev/test unless AIRGAPPED/production is set.
 */
export function assertSecretsHardened(
    env: NodeJS.ProcessEnv = process.env,
): void {
    const enforced =
        env.AIRGAPPED === "true" || env.NODE_ENV === "production";
    if (!enforced) return;

    const problems: string[] = [];

    const jwtSecret = env.JWT_SECRET ?? env.SUPABASE_JWT_SECRET;
    if (jwtSecret === DEMO_JWT_SECRET) {
        problems.push(
            "JWT_SECRET is the Supabase demo secret — run gen-secrets.sh",
        );
    }

    // Any Supabase key still signed by the demo issuer is forgeable.
    for (const name of [
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SERVICE_ROLE_KEY",
        "ANON_KEY",
    ]) {
        if (jwtIssuer(env[name]) === "supabase-demo") {
            problems.push(`${name} is a Supabase demo key — run gen-secrets.sh`);
        }
    }

    const require32 = (name: string) => {
        const v = env[name];
        if (!v || v.length < 32) {
            problems.push(`${name} must be a strong value (>= 32 chars)`);
        } else if (PLACEHOLDER_PATTERNS.some((p) => p.test(v))) {
            problems.push(`${name} looks like a placeholder`);
        }
    };
    require32("USER_API_KEYS_ENCRYPTION_SECRET");
    require32("DOWNLOAD_SIGNING_SECRET");
    require32("MCP_CONNECTORS_ENCRYPTION_SECRET");

    // The anon/service keys must actually be signed by JWT_SECRET, or every
    // request 401s at PostgREST/GoTrue while the demo-issuer check above still
    // passes — a silent, confusing break. Verify the triple is consistent.
    if (jwtSecret) {
        for (const name of ["ANON_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) {
            const tok = env[name];
            if (tok && tok.split(".").length === 3 && !jwtSignedBy(tok, jwtSecret)) {
                problems.push(
                    `${name} is not signed by JWT_SECRET (mismatched secret/keys — regenerate together)`,
                );
            }
        }
    }

    if (problems.length > 0) {
        throw new Error(
            "Refusing to start with insecure secrets:\n  - " +
                problems.join("\n  - "),
        );
    }
}
