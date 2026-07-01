import { describe, expect, it, vi } from "vitest";

// Importing the Ollama adapter pulls in the OpenAI adapter, which reads the
// validated env at module load; mock it so the test doesn't need a full env.
vi.mock("../../../env", () => ({
    env: { NODE_ENV: "test", OPENAI_ALLOW_LOCAL_BASE_URL: "false" },
}));

import { setupOllamaFromEnv } from "../ollama";
import { getRegisteredProvider } from "../../registry";

describe("setupOllamaFromEnv (ENABLE_OLLAMA gate)", () => {
    it("does nothing when the flag is unset or not 'true'", () => {
        expect(setupOllamaFromEnv({})).toBe(false);
        expect(setupOllamaFromEnv({ ENABLE_OLLAMA: "false" })).toBe(false);
        expect(setupOllamaFromEnv({ ENABLE_OLLAMA: "1" })).toBe(false);
    });

    it("registers the Ollama provider when ENABLE_OLLAMA=true", () => {
        expect(setupOllamaFromEnv({ ENABLE_OLLAMA: "true" })).toBe(true);
        const provider = getRegisteredProvider("ollama");
        expect(provider).toBeDefined();
        // A default local model routes to this provider.
        expect(provider?.matchesModel("llama3.3")).toBe(true);
        // A cloud model does not.
        expect(provider?.matchesModel("gpt-4o")).toBe(false);
    });

    it("registers extra models from OLLAMA_MODELS", () => {
        setupOllamaFromEnv({
            ENABLE_OLLAMA: "true",
            OLLAMA_MODELS: "my-custom-model, another-model",
        });
        const provider = getRegisteredProvider("ollama");
        expect(provider?.matchesModel("my-custom-model")).toBe(true);
        expect(provider?.matchesModel("another-model")).toBe(true);
    });
});
