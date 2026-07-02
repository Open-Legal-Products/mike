/**
 * DMS connector public API + registry.
 *
 * This mirrors the StorageAdapter pluggability pattern (lib/storage.ts), but
 * where storage has a single swappable singleton, a DMS deployment can talk to
 * several backends at once, so the registry is keyed by connector kind
 * ("fake" | "imanage" | "netdocuments"). To add a vendor, implement
 * DMSConnector (lib/dms/adapter.ts) and register a factory:
 *
 *   import { registerDmsAdapter } from "./lib/dms";
 *   registerDmsAdapter("worldox", (config) => new WorldoxAdapter(config));
 *
 * All callers resolve an adapter via getDmsAdapter(kind, config) and never need
 * to know which concrete class backs a kind — the same indirection tests use to
 * swap a cloud kind for the in-memory Fake.
 */
import type { DmsAdapterConfig, DmsConnector, DmsKind } from "./adapter";
import { FakeDMSAdapter, sharedFakeDms } from "./fake";
import { IManageAdapter } from "./imanage";
import { NetDocumentsAdapter } from "./netdocuments";

export type { DmsConnector, DmsAdapterConfig, DmsKind } from "./adapter";
export type {
    DmsFolder,
    DmsSearchResult,
    DmsSearchOptions,
    DmsDocument,
    DmsDocumentMetadata,
    DmsExportOptions,
    DmsExportResult,
} from "./adapter";
export { FakeDMSAdapter, sharedFakeDms } from "./fake";
export { IManageAdapter } from "./imanage";
export { NetDocumentsAdapter } from "./netdocuments";

/** Constructs a connector for a given kind from its per-connector config. */
export type DmsAdapterFactory = (config: DmsAdapterConfig) => DmsConnector;

// Default factories. The `fake` factory returns the process-wide shared
// instance so a `fake` connector row and any direct caller observe one backing
// store (as they would with a real DMS).
const registry = new Map<DmsKind, DmsAdapterFactory>([
    ["fake", () => sharedFakeDms],
    ["imanage", (config) => new IManageAdapter(config)],
    ["netdocuments", (config) => new NetDocumentsAdapter(config)],
]);

/**
 * Replace or add the factory for a connector kind. Tests use this to swap a
 * cloud kind ("imanage") for an in-memory FakeDMSAdapter without touching any
 * caller — the DMS analog of setStorageAdapter().
 */
export function registerDmsAdapter(
    kind: DmsKind,
    factory: DmsAdapterFactory,
): void {
    registry.set(kind, factory);
}

/** Resolve a connector for a kind. Throws for an unknown kind. */
export function getDmsAdapter(
    kind: DmsKind,
    config: DmsAdapterConfig,
): DmsConnector {
    const factory = registry.get(kind);
    if (!factory) {
        throw new Error(`No DMS adapter registered for kind "${kind}".`);
    }
    return factory(config);
}

/** Every kind with a registered factory. */
export function listDmsAdapters(): DmsKind[] {
    return [...registry.keys()];
}

/** The kinds that reach an external cloud SaaS (and must be air-gap gated). */
export const CLOUD_DMS_KINDS: DmsKind[] = ["imanage", "netdocuments"];

/** True when a kind reaches out to the network (everything but the Fake). */
export function isCloudDmsKind(kind: DmsKind): boolean {
    return CLOUD_DMS_KINDS.includes(kind);
}

/**
 * Restore the built-in registry (test helper). Keeps unit tests that swap a
 * factory from leaking into one another.
 */
export function resetDmsRegistryForTests(): void {
    registry.clear();
    registry.set("fake", () => sharedFakeDms);
    registry.set("imanage", (config) => new IManageAdapter(config));
    registry.set("netdocuments", (config) => new NetDocumentsAdapter(config));
    if (sharedFakeDms instanceof FakeDMSAdapter) sharedFakeDms.reset();
}
