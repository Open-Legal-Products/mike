import assert from "node:assert/strict";
import test from "node:test";
import {
    enforceHostedDataBoundary,
    isContentBearingRequest,
} from "./dataBoundary";
import type { RuntimeConfig } from "../config/runtime";

const config: RuntimeConfig = {
    environment: "test",
    port: 3001,
    allowedOrigins: ["http://localhost:3000"],
    hostedMode: "controlled-beta",
    dataBoundaryVersion: "test-v1",
    hostedModelProviders: ["openai"],
};

test("content-bearing write routes are identified without blocking reads or deletion", () => {
    assert.equal(isContentBearingRequest("POST", "/chat"), true);
    assert.equal(
        isContentBearingRequest("PUT", "/single-documents/id/versions/v/file"),
        true,
    );
    assert.equal(isContentBearingRequest("GET", "/chat"), false);
    assert.equal(isContentBearingRequest("DELETE", "/projects/id"), false);
    assert.equal(
        isContentBearingRequest("POST", "/legal-sources/citations/verify"),
        false,
    );
});

test("controlled beta rejects content without the exact acknowledgement", () => {
    let status = 0;
    let body: unknown;
    let nextCalled = false;
    const middleware = enforceHostedDataBoundary(config);
    middleware(
        {
            method: "POST",
            originalUrl: "/chat",
            path: "/chat",
            header: () => undefined,
        } as never,
        {
            status(code: number) {
                status = code;
                return this;
            },
            json(value: unknown) {
                body = value;
                return this;
            },
            setHeader() {},
        } as never,
        () => {
            nextCalled = true;
        },
    );
    assert.equal(status, 428);
    assert.equal(nextCalled, false);
    assert.match(
        JSON.stringify(body),
        /synthetic or affirmatively non-confidential/,
    );
});

test("controlled beta accepts the exact acknowledgement and self-hosted mode is unchanged", () => {
    let betaNext = false;
    enforceHostedDataBoundary(config)(
        {
            method: "POST",
            originalUrl: "/projects/id/documents",
            path: "/projects/id/documents",
            header: () => "synthetic-or-non-confidential",
        } as never,
        { setHeader() {} } as never,
        () => {
            betaNext = true;
        },
    );
    assert.equal(betaNext, true);

    let selfHostedNext = false;
    enforceHostedDataBoundary({ ...config, hostedMode: "self-hosted" })(
        {
            method: "POST",
            originalUrl: "/chat",
            path: "/chat",
            header: () => undefined,
        } as never,
        {} as never,
        () => {
            selfHostedNext = true;
        },
    );
    assert.equal(selfHostedNext, true);
});
