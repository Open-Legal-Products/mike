import {
  configureMikeApiClient,
  createChat,
  createProject,
  deleteProject,
  getChat,
  getProject,
  listChats,
  listProjects,
  updateProject,
  uploadProjectDocument,
  uploadStandaloneDocument,
  type AuthHeaderProvider,
} from "@mike/api-client";

export * from "@mike/core";
export * from "@mike/api-client";

export type MikeClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  getAuthHeaders?: AuthHeaderProvider;
  fetchImpl?: typeof fetch;
};

export class MikeClient {
  constructor(options: MikeClientOptions = {}) {
    configureMikeApiClient({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      getAuthHeaders:
        options.getAuthHeaders ??
        (async (): Promise<Record<string, string>> =>
          options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    });
  }

  projects = {
    list: listProjects,
    create: createProject,
    get: getProject,
    update: updateProject,
    delete: deleteProject,
  };

  chats = {
    create: createChat,
    list: listChats,
    get: getChat,
  };

  documents = {
    uploadToProject: uploadProjectDocument,
    uploadStandalone: uploadStandaloneDocument,
  };
}
