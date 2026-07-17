import { z } from "zod";

const A2AJ_DEFAULT_BASE_URL = "https://api.a2aj.ca";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;

const a2ajDocumentSchema = z
    .object({
        dataset: z.string().trim().min(1),
        citation_en: z.string().nullish(),
        citation_fr: z.string().nullish(),
        citation2_en: z.string().nullish(),
        citation2_fr: z.string().nullish(),
        name_en: z.string().nullish(),
        name_fr: z.string().nullish(),
        document_date_en: z.string().nullish(),
        document_date_fr: z.string().nullish(),
        url_en: z.string().nullish(),
        url_fr: z.string().nullish(),
        unofficial_text_en: z.string().nullish(),
        unofficial_text_fr: z.string().nullish(),
        scraped_timestamp_en: z.string().nullish(),
        scraped_timestamp_fr: z.string().nullish(),
        cases_cited_en: z.array(z.string()).nullish(),
        cases_cited_fr: z.array(z.string()).nullish(),
        cases_citing_en: z.array(z.string()).nullish(),
        cases_citing_fr: z.array(z.string()).nullish(),
        citing_cases_count: z.number().int().nonnegative().nullish(),
        upstream_license: z.string().nullish(),
    })
    .passthrough();

const searchResponseSchema = z
    .object({
        results: z.array(a2ajDocumentSchema),
        total: z.number().int().nonnegative().optional(),
    })
    .passthrough();

const documentResultSchema = z
    .object({ result: a2ajDocumentSchema })
    .passthrough();
const documentResultsSchema = z
    .object({ results: z.array(a2ajDocumentSchema).min(1) })
    .passthrough();
const coverageRowsSchema = z.array(z.record(z.unknown()));

export type A2ajDocument = z.infer<typeof a2ajDocumentSchema>;
export type A2ajCoverageRow = Record<string, unknown>;

export class A2ajApiError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "A2ajApiError";
    }
}

type A2ajClientOptions = {
    baseUrl?: string;
    timeoutMs?: number;
    maxRetries?: number;
    failureThreshold?: number;
    circuitResetMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
};

export class A2ajClient {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly failureThreshold: number;
    private readonly circuitResetMs: number;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private consecutiveFailures = 0;
    private circuitOpenedAt: number | null = null;

    constructor(options: A2ajClientOptions = {}) {
        this.baseUrl = (
            options.baseUrl ??
            process.env.A2AJ_API_BASE_URL ??
            A2AJ_DEFAULT_BASE_URL
        ).replace(/\/$/, "");
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.failureThreshold =
            options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
        this.circuitResetMs =
            options.circuitResetMs ?? DEFAULT_CIRCUIT_RESET_MS;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now = options.now ?? Date.now;
        this.sleep =
            options.sleep ??
            ((milliseconds) =>
                new Promise((resolve) => setTimeout(resolve, milliseconds)));
    }

    async search(input: {
        query: string;
        dataset?: string;
        language?: "en" | "fr";
        from?: string;
        to?: string;
        size?: number;
        offset?: number;
    }) {
        const params = new URLSearchParams({
            query: input.query,
            doc_type: "cases",
            size: String(Math.min(100, Math.max(1, input.size ?? 10))),
        });
        if (input.dataset) params.set("dataset", input.dataset);
        if (input.language) params.set("language", input.language);
        if (input.from) params.set("date_from", input.from);
        if (input.to) params.set("date_to", input.to);
        if (input.offset) params.set("from", String(Math.max(0, input.offset)));
        return searchResponseSchema.parse(
            await this.request(`/search?${params}`),
        );
    }

    async fetchByCitation(citation: string) {
        const params = new URLSearchParams({ citation, doc_type: "cases" });
        const raw = await this.request(`/fetch?${params}`);
        const direct = a2ajDocumentSchema.safeParse(raw);
        if (direct.success) return direct.data;
        const result = documentResultSchema.safeParse(raw);
        if (result.success) return result.data.result;
        return documentResultsSchema.parse(raw).results[0];
    }

    async coverage(): Promise<A2ajCoverageRow[]> {
        const raw = await this.request("/coverage");
        const direct = coverageRowsSchema.safeParse(raw);
        if (direct.success) return direct.data;
        const wrapper = z.record(z.unknown()).parse(raw);
        for (const key of ["coverage", "datasets", "results"] as const) {
            const rows = coverageRowsSchema.safeParse(wrapper[key]);
            if (rows.success) return rows.data;
        }
        throw new A2ajApiError("A2AJ returned an invalid coverage response.");
    }

    private assertCircuitAvailable() {
        if (this.circuitOpenedAt === null) return;
        if (this.now() - this.circuitOpenedAt >= this.circuitResetMs) {
            this.circuitOpenedAt = null;
            this.consecutiveFailures = 0;
            return;
        }
        throw new A2ajApiError(
            "A2AJ is temporarily unavailable because its circuit breaker is open.",
        );
    }

    private noteSuccess() {
        this.consecutiveFailures = 0;
        this.circuitOpenedAt = null;
    }

    private noteFailure() {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.failureThreshold)
            this.circuitOpenedAt = this.now();
    }

    private async request(path: string): Promise<unknown> {
        this.assertCircuitAvailable();
        let lastError: unknown;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            try {
                const response = await this.fetchImpl(
                    `${this.baseUrl}${path}`,
                    {
                        headers: {
                            Accept: "application/json",
                            "User-Agent": "ROSS-RanadeOSS/0.1",
                        },
                        signal: AbortSignal.timeout(this.timeoutMs),
                    },
                );
                if (!response.ok) {
                    const detail = (
                        await response.text().catch(() => "")
                    ).trim();
                    const retryAfterSeconds = parseRetryAfter(
                        response.headers.get("retry-after"),
                    );
                    throw new A2ajApiError(
                        detail
                            ? `A2AJ error (${response.status}): ${detail}`
                            : `A2AJ error (${response.status})`,
                        response.status,
                        retryAfterSeconds,
                    );
                }
                const json = (await response.json()) as unknown;
                this.noteSuccess();
                return json;
            } catch (error) {
                lastError = error;
                if (!isRetriable(error) || attempt === this.maxRetries) break;
                const retryAfter =
                    error instanceof A2ajApiError
                        ? error.retryAfterSeconds
                        : undefined;
                const delay =
                    retryAfter !== undefined
                        ? Math.min(5_000, retryAfter * 1_000)
                        : 250 * 2 ** attempt;
                await this.sleep(delay);
            }
        }
        this.noteFailure();
        if (lastError instanceof Error) throw lastError;
        throw new A2ajApiError("A2AJ request failed.");
    }
}

function parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function isRetriable(error: unknown) {
    if (!(error instanceof A2ajApiError))
        return (
            error instanceof TypeError ||
            (error instanceof Error && error.name === "TimeoutError")
        );
    return (
        error.status === 429 ||
        (error.status !== undefined && error.status >= 500)
    );
}
