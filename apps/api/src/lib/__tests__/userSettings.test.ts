import { describe, it, expect, vi } from "vitest";

// resolveTabularModel value-imports the llm barrel, whose import graph reaches
// lib/env and runs the real zod validation. Populate the two required secrets
// before that graph loads (vi.hoisted runs before imports) so validation passes.
//
// The two *_SECRET vars are assigned UNCONDITIONALLY (not `??=`): the CI "API
// tests" job pre-exports them at *under* the 32-char minimum the env schema
// enforces (DOWNLOAD_SIGNING_SECRET=30, USER_API_KEYS_ENCRYPTION_SECRET=31), so
// a nullish-guard would leave those too-short values in place and env validation
// would throw at import — failing this file only in CI. Overwriting matches the
// convention used elsewhere (see downloadTokens.test.ts, dms/fakeEnv.ts) and
// keeps this a network-free unit test. SUPABASE_* have no length rule, so we
// only fill them when unset.
vi.hoisted(() => {
    process.env.DOWNLOAD_SIGNING_SECRET = "x".repeat(32);
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = "y".repeat(32);
    process.env.SUPABASE_URL ??= "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY ??= "test-secret-key";
});

import { resolveTabularModel } from "../userSettings";
import {
    DEFAULT_TABULAR_MODEL,
    CLAUDE_MID_MODELS,
    OPENAI_MID_MODELS,
    providerForModel,
} from "../llm";

describe("resolveTabularModel", () => {
    it("uses the Gemini default when a Gemini key is configured", () => {
        expect(resolveTabularModel(null, { gemini: "g-key" })).toBe(
            DEFAULT_TABULAR_MODEL,
        );
    });

    it("falls back to a Claude mid-tier model when only Claude is keyed", () => {
        // The reported bug: default is a Gemini model but the user only has an
        // Anthropic key, so the run failed with "API key required" instead of
        // falling back to a model they can actually use.
        const model = resolveTabularModel(null, { claude: "c-key" });
        expect(model).toBe(CLAUDE_MID_MODELS[0]);
        expect(providerForModel(model)).toBe("claude");
    });

    it("falls back to an OpenAI mid-tier model when only OpenAI is keyed", () => {
        const model = resolveTabularModel(null, { openai: "o-key" });
        expect(model).toBe(OPENAI_MID_MODELS[0]);
        expect(providerForModel(model)).toBe("openai");
    });

    it("swaps an explicit but keyless choice to a keyed provider", () => {
        // User explicitly picked a Gemini model but has no Gemini key.
        const model = resolveTabularModel("gemini-3-flash-preview", {
            claude: "c-key",
        });
        expect(providerForModel(model)).toBe("claude");
    });

    it("honours an explicit choice when its provider is keyed", () => {
        const model = resolveTabularModel("claude-sonnet-4-6", {
            claude: "c-key",
            gemini: "g-key",
        });
        expect(model).toBe("claude-sonnet-4-6");
    });

    it("keeps the default (unchanged behaviour) when no provider is keyed", () => {
        // Truly keyless user: leave the model as-is so the existing
        // demo / missing-key path still fires.
        expect(resolveTabularModel(null, {})).toBe(DEFAULT_TABULAR_MODEL);
    });
});
