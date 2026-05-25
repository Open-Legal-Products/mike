import { createMikeApiClient, type AuthHeaderProvider } from "@mike/api-client";

export * from "@mike/core";
export * from "@mike/api-client";

export type MikeClientOptions = {
    baseUrl?: string;
    apiKey?: string;
    getAuthHeaders?: AuthHeaderProvider;
    fetchImpl?: typeof fetch;
};

export class MikeClient {
    private readonly client: ReturnType<typeof createMikeApiClient>;

    constructor(options: MikeClientOptions = {}) {
        this.client = createMikeApiClient({
            baseUrl: options.baseUrl,
            fetchImpl: options.fetchImpl,
            getAuthHeaders:
                options.getAuthHeaders ??
                (async (): Promise<Record<string, string>> =>
                    options.apiKey
                        ? { Authorization: `Bearer ${options.apiKey}` }
                        : {}),
        });
    }

    projects = {
        list: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["projects"]["list"]
            >
        ) => this.client.projects.list(...args),
        create: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["projects"]["create"]
            >
        ) => this.client.projects.create(...args),
        get: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["projects"]["get"]
            >
        ) => this.client.projects.get(...args),
        update: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["projects"]["update"]
            >
        ) => this.client.projects.update(...args),
        delete: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["projects"]["delete"]
            >
        ) => this.client.projects.delete(...args),
    };

    chats = {
        create: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["chats"]["create"]
            >
        ) => this.client.chats.create(...args),
        list: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["chats"]["list"]
            >
        ) => this.client.chats.list(...args),
        get: (
            ...args: Parameters<
                ReturnType<typeof createMikeApiClient>["chats"]["get"]
            >
        ) => this.client.chats.get(...args),
    };

    documents = {
        uploadToProject: (
            ...args: Parameters<
                ReturnType<
                    typeof createMikeApiClient
                >["documents"]["uploadToProject"]
            >
        ) => this.client.documents.uploadToProject(...args),
        uploadStandalone: (
            ...args: Parameters<
                ReturnType<
                    typeof createMikeApiClient
                >["documents"]["uploadStandalone"]
            >
        ) => this.client.documents.uploadStandalone(...args),
    };
}
