import type {
    LegalSourceProvider,
    LegalSourceProviderDescriptor,
} from "./types";

export type LicensedConnectorOperation =
    | "metadata-search"
    | "citation-lookup"
    | "citator"
    | "full-text-fetch";

export type LicensedConnectorEntitlement = {
    providerId: string;
    enabled: boolean;
    contractId: string | null;
    organizationId: string | null;
    allowedOperations: ReadonlySet<LicensedConnectorOperation>;
    metadataRetentionDays: number;
    fullTextRetentionDays: number;
    redistributionAllowed: boolean;
    credentialConfigured: boolean;
    transportConfigured: boolean;
};

export type LicensedConnectorAuditEvent = {
    providerId: string;
    operation: LicensedConnectorOperation;
    organizationId: string;
    contractId: string;
    allowed: boolean;
    occurredAt: string;
    reason?: string;
};

export class LicensedConnectorGate {
    constructor(
        readonly entitlement: LicensedConnectorEntitlement,
        private readonly audit: (
            event: LicensedConnectorAuditEvent,
        ) => Promise<void> | void = () => undefined,
    ) {}

    async authorize(operation: LicensedConnectorOperation) {
        const reason = this.denialReason(operation);
        const event: LicensedConnectorAuditEvent = {
            providerId: this.entitlement.providerId,
            operation,
            organizationId: this.entitlement.organizationId ?? "unconfigured",
            contractId: this.entitlement.contractId ?? "unconfigured",
            allowed: !reason,
            occurredAt: new Date().toISOString(),
            ...(reason ? { reason } : {}),
        };
        await this.audit(event);
        if (reason) throw new Error(reason);
        return this.entitlement;
    }

    status() {
        const configured =
            this.entitlement.enabled &&
            this.entitlement.credentialConfigured &&
            this.entitlement.transportConfigured &&
            Boolean(this.entitlement.contractId) &&
            Boolean(this.entitlement.organizationId);
        return {
            configured,
            enabled: this.entitlement.enabled,
            allowedOperations: [...this.entitlement.allowedOperations],
            metadataRetentionDays: this.entitlement.metadataRetentionDays,
            fullTextRetentionDays: this.entitlement.fullTextRetentionDays,
            redistributionAllowed: this.entitlement.redistributionAllowed,
        };
    }

    private denialReason(operation: LicensedConnectorOperation) {
        if (!this.entitlement.enabled)
            return `${this.entitlement.providerId} is disabled. An approved organization entitlement is required.`;
        if (!this.entitlement.contractId || !this.entitlement.organizationId)
            return `${this.entitlement.providerId} contract and organization identifiers are required.`;
        if (!this.entitlement.credentialConfigured)
            return `${this.entitlement.providerId} credentials are not configured.`;
        if (!this.entitlement.transportConfigured)
            return `${this.entitlement.providerId} has no approved contract transport adapter.`;
        if (!this.entitlement.allowedOperations.has(operation))
            return `${this.entitlement.providerId} entitlement does not allow ${operation}.`;
        return null;
    }
}

export class CanLiiLicensedProvider implements LegalSourceProvider {
    readonly descriptor: LegalSourceProviderDescriptor = {
        id: "canlii-licensed",
        name: "CanLII authorized connector",
        jurisdictions: ["CA", "CA-ON"],
        kinds: ["decision", "legislation", "regulation"],
        official: false,
        fullTextStatus: "metadata-only",
        enabledByDefault: false,
    };

    readonly gate: LicensedConnectorGate;

    constructor(
        environment: NodeJS.ProcessEnv = process.env,
        audit?: (event: LicensedConnectorAuditEvent) => Promise<void> | void,
    ) {
        this.gate = new LicensedConnectorGate(
            loadCanLiiEntitlement(environment),
            audit,
        );
    }

    async health() {
        const status = this.gate.status();
        if (!status.enabled)
            return {
                ok: false,
                detail: "Disabled by default. ROSS does not scrape CanLII; an authorized contract connector is required.",
            };
        if (!status.configured)
            return {
                ok: false,
                detail: "Entitlement is incomplete. Contract, organization, credential, and approved transport configuration are required.",
            };
        return {
            ok: true,
            detail: `Authorized operations: ${status.allowedOperations.join(", ") || "none"}.`,
        };
    }
}

export function loadCanLiiEntitlement(
    environment: NodeJS.ProcessEnv,
): LicensedConnectorEntitlement {
    const operations = new Set<LicensedConnectorOperation>();
    for (const value of (environment.CANLII_ALLOWED_OPERATIONS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)) {
        if (isLicensedOperation(value)) operations.add(value);
        else
            throw new Error(
                `Unsupported CanLII operation in configuration: ${value}`,
            );
    }

    if (
        operations.has("full-text-fetch") &&
        environment.CANLII_FULL_TEXT_ENTITLED !== "true"
    )
        throw new Error(
            "CANLII_FULL_TEXT_ENTITLED=true is required for full-text-fetch.",
        );

    return {
        providerId: "canlii-licensed",
        enabled: environment.CANLII_CONNECTOR_ENABLED === "true",
        contractId: nonSecret(environment.CANLII_CONTRACT_ID),
        organizationId: nonSecret(environment.CANLII_ORGANIZATION_ID),
        allowedOperations: operations,
        metadataRetentionDays: boundedDays(
            environment.CANLII_METADATA_RETENTION_DAYS,
            0,
        ),
        fullTextRetentionDays: boundedDays(
            environment.CANLII_FULL_TEXT_RETENTION_DAYS,
            0,
        ),
        redistributionAllowed:
            environment.CANLII_REDISTRIBUTION_ALLOWED === "true",
        credentialConfigured: Boolean(environment.CANLII_API_KEY?.trim()),
        transportConfigured:
            environment.CANLII_APPROVED_TRANSPORT === "contract-v1" &&
            isApprovedCanLiiBaseUrl(environment.CANLII_API_BASE_URL),
    };
}

function isLicensedOperation(
    value: string,
): value is LicensedConnectorOperation {
    return [
        "metadata-search",
        "citation-lookup",
        "citator",
        "full-text-fetch",
    ].includes(value);
}

function boundedDays(value: string | undefined, fallback: number) {
    if (!value?.trim()) return fallback;
    const days = Number.parseInt(value, 10);
    if (!Number.isInteger(days) || days < 0 || days > 3650)
        throw new Error("Connector retention days must be between 0 and 3650.");
    return days;
}

function isApprovedCanLiiBaseUrl(value: string | undefined) {
    if (!value?.trim()) return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            url.hostname === "api.canlii.org" &&
            !url.username &&
            !url.password
        );
    } catch {
        return false;
    }
}

function nonSecret(value: string | undefined) {
    return value?.trim() || null;
}
