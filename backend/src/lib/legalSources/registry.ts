import type { JurisdictionCode, LegalSourceKind, LegalSourceProvider } from "./types";

export class LegalSourceRegistry {
    private readonly providers = new Map<string, LegalSourceProvider>();

    register(provider: LegalSourceProvider): this {
        const { id } = provider.descriptor;
        if (this.providers.has(id)) throw new Error(`Legal source provider already registered: ${id}`);
        this.providers.set(id, provider);
        return this;
    }

    get(id: string): LegalSourceProvider {
        const provider = this.providers.get(id);
        if (!provider) throw new Error(`Unknown legal source provider: ${id}`);
        return provider;
    }

    list(filters?: { jurisdiction?: JurisdictionCode; kind?: LegalSourceKind }): LegalSourceProvider[] {
        return [...this.providers.values()].filter((provider) => {
            if (filters?.jurisdiction && !provider.descriptor.jurisdictions.includes(filters.jurisdiction)) return false;
            if (filters?.kind && !provider.descriptor.kinds.includes(filters.kind)) return false;
            return true;
        });
    }

    describe() {
        return this.list().map((provider) => provider.descriptor);
    }
}
