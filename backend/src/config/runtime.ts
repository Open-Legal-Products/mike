export type RossEnvironment = "local" | "test" | "staging" | "production";
export type RossHostedMode = "self-hosted" | "controlled-beta" | "production";

export type RuntimeConfig = {
    environment: RossEnvironment;
    port: number;
    allowedOrigins: string[];
    hostedMode: RossHostedMode;
    dataBoundaryVersion: string;
    hostedModelProviders: Array<"claude" | "gemini" | "openai">;
};

const PLACEHOLDER =
    /(^|[.:/])(example\.invalid|localhost)([/:]|$)|your-|replace-with/i;

function cleanUrl(value: string, name: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${name} must be an absolute URL.`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error(`${name} must use http or https.`);
    }
    return parsed.origin;
}

export function parseAllowedOrigins(value?: string): string[] {
    const configured = value?.trim() || "http://localhost:3000";
    const origins = Array.from(
        new Set(
            configured
                .split(",")
                .map((origin) => origin.trim())
                .filter(Boolean)
                .map((origin) => cleanUrl(origin, "CORS_ALLOWED_ORIGINS")),
        ),
    );
    if (!origins.length)
        throw new Error("At least one CORS origin is required.");
    return origins;
}

function requiredProductionValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value || PLACEHOLDER.test(value)) {
        throw new Error(
            `${name} must be configured with a non-placeholder production value.`,
        );
    }
    return value;
}

function environment(): RossEnvironment {
    const value = (
        process.env.ROSS_ENV ??
        process.env.NODE_ENV ??
        "local"
    ).toLowerCase();
    if (value === "development") return "local";
    if (
        value === "local" ||
        value === "test" ||
        value === "staging" ||
        value === "production"
    ) {
        return value;
    }
    throw new Error(`Unsupported ROSS_ENV: ${value}`);
}

function hostedMode(environment: RossEnvironment): RossHostedMode {
    const configured = process.env.ROSS_HOSTED_MODE?.trim().toLowerCase();
    if (!configured) {
        if (environment === "local" || environment === "test")
            return "self-hosted";
        throw new Error(
            "ROSS_HOSTED_MODE is required in staging and production.",
        );
    }
    if (
        configured === "self-hosted" ||
        configured === "controlled-beta" ||
        configured === "production"
    )
        return configured;
    throw new Error(`Unsupported ROSS_HOSTED_MODE: ${configured}`);
}

function hostedModelProviders(mode: RossHostedMode) {
    if (mode === "self-hosted") return [];
    const raw = process.env.HOSTED_MODEL_PROVIDERS?.trim();
    if (!raw)
        throw new Error(
            "HOSTED_MODEL_PROVIDERS is required for a hosted deployment.",
        );
    const providers = Array.from(
        new Set(raw.split(",").map((value) => value.trim().toLowerCase())),
    );
    if (
        providers.length === 0 ||
        providers.some(
            (provider) =>
                provider !== "claude" &&
                provider !== "gemini" &&
                provider !== "openai",
        )
    )
        throw new Error(
            "HOSTED_MODEL_PROVIDERS may contain only claude, gemini, and openai.",
        );
    return providers as Array<"claude" | "gemini" | "openai">;
}

export function loadRuntimeConfig(): RuntimeConfig {
    const currentEnvironment = environment();
    const currentHostedMode = hostedMode(currentEnvironment);
    const allowedOrigins = parseAllowedOrigins(
        process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_URL,
    );

    if (currentEnvironment === "production") {
        for (const name of [
            "SUPABASE_URL",
            "SUPABASE_SECRET_KEY",
            "DOWNLOAD_SIGNING_SECRET",
            "R2_ENDPOINT_URL",
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
            "R2_BUCKET_NAME",
        ])
            requiredProductionValue(name);
        if (allowedOrigins.some((origin) => PLACEHOLDER.test(origin))) {
            throw new Error(
                "Production CORS origins cannot use localhost or placeholder domains.",
            );
        }
    }

    if (
        currentEnvironment !== "local" &&
        (process.env.LOG_RAW_LLM_STREAM === "true" ||
            process.env.RAW_LLM_STREAM_LOG_DIR?.trim())
    )
        throw new Error(
            "Raw LLM stream logging is forbidden outside local development.",
        );

    if (
        currentHostedMode === "production" &&
        process.env.ROSS_PRODUCTION_CONTROLS_APPROVED !== "true"
    )
        throw new Error(
            "Production hosted mode requires ROSS_PRODUCTION_CONTROLS_APPROVED=true after recorded approvals.",
        );

    const requestedPort = Number.parseInt(process.env.PORT ?? "3001", 10);
    return {
        environment: currentEnvironment,
        port:
            Number.isFinite(requestedPort) && requestedPort > 0
                ? requestedPort
                : 3001,
        allowedOrigins,
        hostedMode: currentHostedMode,
        dataBoundaryVersion:
            process.env.ROSS_DATA_BOUNDARY_VERSION?.trim() || "2026-07-16",
        hostedModelProviders: hostedModelProviders(currentHostedMode),
    };
}
