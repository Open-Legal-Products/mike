import assert from "node:assert/strict";
import test from "node:test";
import {
    CanLiiLicensedProvider,
    LicensedConnectorGate,
    loadCanLiiEntitlement,
    type LicensedConnectorAuditEvent,
} from "./licensedConnector";

test("CanLII connector is disabled and credential-safe by default", async () => {
    const provider = new CanLiiLicensedProvider({});
    const health = await provider.health();
    assert.equal(health.ok, false);
    assert.match(health.detail ?? "", /does not scrape CanLII/);
    assert.deepEqual(provider.gate.status(), {
        configured: false,
        enabled: false,
        allowedOperations: [],
        metadataRetentionDays: 0,
        fullTextRetentionDays: 0,
        redistributionAllowed: false,
    });
});

test("licensed gate requires the complete approved entitlement", async () => {
    const events: LicensedConnectorAuditEvent[] = [];
    const gate = new LicensedConnectorGate(
        loadCanLiiEntitlement({ CANLII_CONNECTOR_ENABLED: "true" }),
        (event) => {
            events.push(event);
        },
    );
    await assert.rejects(
        () => gate.authorize("metadata-search"),
        /contract and organization identifiers are required/,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].allowed, false);
    assert.equal(events[0].operation, "metadata-search");
});

test("full text requires an explicit operation and entitlement", () => {
    assert.throws(
        () =>
            loadCanLiiEntitlement({
                CANLII_ALLOWED_OPERATIONS: "full-text-fetch",
            }),
        /CANLII_FULL_TEXT_ENTITLED=true/,
    );
});

test("complete licensed metadata configuration exposes no secret", async () => {
    const provider = new CanLiiLicensedProvider({
        CANLII_CONNECTOR_ENABLED: "true",
        CANLII_CONTRACT_ID: "synthetic-contract",
        CANLII_ORGANIZATION_ID: "synthetic-org",
        CANLII_API_KEY: "SYNTHETIC-SECRET-NEVER-RETURN",
        CANLII_API_BASE_URL: "https://api.canlii.org/v1",
        CANLII_APPROVED_TRANSPORT: "contract-v1",
        CANLII_ALLOWED_OPERATIONS: "metadata-search,citator",
        CANLII_METADATA_RETENTION_DAYS: "30",
    });
    const health = await provider.health();
    assert.equal(health.ok, true);
    assert.doesNotMatch(
        JSON.stringify(provider.gate.status()),
        /SYNTHETIC-SECRET/,
    );
    await provider.gate.authorize("metadata-search");
    await assert.rejects(
        () => provider.gate.authorize("full-text-fetch"),
        /does not allow full-text-fetch/,
    );
});
