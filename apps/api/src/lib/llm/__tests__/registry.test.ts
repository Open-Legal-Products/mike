import { describe, it, expect, beforeEach } from "vitest";
import {
    registerProvider,
    getRegisteredProvider,
    findProviderForModel,
    registeredProviderIds,
    allRegisteredModels,
    _resetRegistryForTesting,
    type LLMProviderAdapter,
} from "../registry";

function makeAdapter(id: string, prefixes: string[], models: string[] = []): LLMProviderAdapter {
    return {
        id,
        matchesModel: (m) => prefixes.some((p) => m.startsWith(p)),
        stream: async () => ({ fullText: "" }),
        complete: async () => "",
        models: { main: models, mid: [], low: [] },
    };
}

beforeEach(() => {
    _resetRegistryForTesting();
});

describe("registerProvider / getRegisteredProvider", () => {
    it("stores and retrieves an adapter by id", () => {
        const adapter = makeAdapter("test", ["test-"]);
        registerProvider(adapter);
        expect(getRegisteredProvider("test")).toBe(adapter);
    });

    it("returns undefined for an unknown id", () => {
        expect(getRegisteredProvider("unknown")).toBeUndefined();
    });

    it("re-registration replaces the previous adapter", () => {
        const first = makeAdapter("p", ["p-"]);
        const second = makeAdapter("p", ["p-"]);
        registerProvider(first);
        registerProvider(second);
        expect(getRegisteredProvider("p")).toBe(second);
    });
});

describe("findProviderForModel", () => {
    it("returns the first provider whose matchesModel is true", () => {
        const a = makeAdapter("alpha", ["alpha-"]);
        const b = makeAdapter("beta", ["beta-"]);
        registerProvider(a);
        registerProvider(b);
        expect(findProviderForModel("alpha-turbo")).toBe(a);
        expect(findProviderForModel("beta-fast")).toBe(b);
    });

    it("returns undefined when no provider matches", () => {
        registerProvider(makeAdapter("x", ["x-"]));
        expect(findProviderForModel("unknown-model")).toBeUndefined();
    });

    it("the first registered provider wins on overlap", () => {
        const first = makeAdapter("first", ["shared-"]);
        const second = makeAdapter("second", ["shared-"]);
        registerProvider(first);
        registerProvider(second);
        expect(findProviderForModel("shared-model")).toBe(first);
    });
});

describe("registeredProviderIds", () => {
    it("returns ids in insertion order", () => {
        registerProvider(makeAdapter("c", ["c-"]));
        registerProvider(makeAdapter("a", ["a-"]));
        registerProvider(makeAdapter("b", ["b-"]));
        expect(registeredProviderIds()).toEqual(["c", "a", "b"]);
    });

    it("returns an empty array when no providers are registered", () => {
        expect(registeredProviderIds()).toEqual([]);
    });
});

describe("allRegisteredModels", () => {
    it("returns the union of all provider model lists", () => {
        registerProvider(makeAdapter("p1", ["m-"], ["m1", "m2"]));
        registerProvider(makeAdapter("p2", ["n-"], ["m2", "n1"]));
        const set = allRegisteredModels();
        expect(set.has("m1")).toBe(true);
        expect(set.has("m2")).toBe(true);
        expect(set.has("n1")).toBe(true);
        expect(set.size).toBe(3);
    });

    it("returns an empty set when no providers are registered", () => {
        expect(allRegisteredModels().size).toBe(0);
    });
});
