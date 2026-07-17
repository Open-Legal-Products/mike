import assert from "node:assert/strict";
import test from "node:test";
import {
    ONTARIO_COURT_FORMS,
    ONTARIO_PROCEDURE_SOURCES,
    calculateOntarioDeadline,
    checkOntarioProcedureSources,
} from "./ontarioProcedure";

test("procedure registry uses official Ontario sources and link-only forms", () => {
    assert.ok(ONTARIO_PROCEDURE_SOURCES.length >= 6);
    assert.ok(
        ONTARIO_PROCEDURE_SOURCES.every((source) =>
            ["www.ontario.ca", "www.ontariocourts.ca"].includes(
                new URL(source.officialUrl).hostname,
            ),
        ),
    );
    assert.ok(ONTARIO_COURT_FORMS.length >= 6);
    assert.ok(
        ONTARIO_COURT_FORMS.every(
            (form) =>
                form.revisionDate === null &&
                form.status === "check-official-current-version",
        ),
    );
});

test("source checks retain response metadata without copying source text", async () => {
    const results = await checkOntarioProcedureSources(
        async () =>
            new Response(null, {
                status: 200,
                headers: {
                    etag: '"synthetic-v1"',
                    "last-modified": "Thu, 16 Jul 2026 12:00:00 GMT",
                },
            }),
    );
    assert.equal(results.length, ONTARIO_PROCEDURE_SOURCES.length);
    assert.equal(results[0].etag, '"synthetic-v1"');
    assert.match(results[0].metadataHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(results[0]).sort(), [
        "checkedAt",
        "etag",
        "lastModified",
        "metadataHash",
        "ok",
        "sourceId",
    ]);
});

test("civil periods of seven days or less exclude Ontario court holidays", () => {
    const result = calculateOntarioDeadline({
        profile: "ontario-civil-rule-3",
        triggerDate: "2026-07-31",
        days: 7,
        calculationTimestamp: "2026-07-16T12:00:00.000Z",
    });
    assert.equal(result.dueDate, "2026-08-12");
    assert.deepEqual(
        result.excludedDates.map(({ date }) => date),
        ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-08", "2026-08-09"],
    );
    assert.equal(result.requiresUserConfirmation, true);
});

test("long civil periods count intermediate holidays but move a holiday due date", () => {
    const result = calculateOntarioDeadline({
        profile: "ontario-civil-rule-3",
        triggerDate: "2026-12-15",
        days: 10,
    });
    assert.equal(result.countedDates.at(-1), "2026-12-25");
    assert.equal(result.dueDate, "2026-12-29");
});

test("Small Claims counts intermediate holidays and moves only a holiday due date", () => {
    const result = calculateOntarioDeadline({
        profile: "ontario-small-claims-rule-3",
        triggerDate: "2026-07-31",
        days: 3,
    });
    assert.deepEqual(result.countedDates, [
        "2026-08-01",
        "2026-08-02",
        "2026-08-03",
    ]);
    assert.equal(result.dueDate, "2026-08-04");
});

test("civil non-originating service after 4 p.m. is deemed on the next non-holiday", () => {
    const result = calculateOntarioDeadline({
        profile: "ontario-civil-rule-3",
        triggerDate: "2026-07-31",
        days: 1,
        serviceLocalTime: "16:01",
        originatingProcess: false,
    });
    assert.equal(result.adjustedTriggerDate, "2026-08-04");
    assert.equal(result.dueDate, "2026-08-05");
    assert.match(result.assumptions.join(" "), /after 4:00 p\.m\./i);
});

test("user-supplied holidays and closures are transparent inputs", () => {
    const result = calculateOntarioDeadline({
        profile: "ontario-civil-rule-3",
        triggerDate: "2026-07-13",
        days: 2,
        additionalHolidays: ["2026-07-14"],
        courtClosures: ["2026-07-15"],
    });
    assert.equal(result.dueDate, "2026-07-17");
    assert.deepEqual(
        result.excludedDates.map(({ reason }) => reason),
        ["User-supplied additional holiday", "User-supplied court closure"],
    );
});

test("deadline inputs fail closed for invalid calendar and time values", () => {
    assert.throws(
        () =>
            calculateOntarioDeadline({
                profile: "ontario-civil-rule-3",
                triggerDate: "2026-02-30",
                days: 1,
            }),
        /valid calendar date/,
    );
    assert.throws(
        () =>
            calculateOntarioDeadline({
                profile: "ontario-civil-rule-3",
                triggerDate: "2026-07-16",
                days: 1,
                serviceLocalTime: "4:30 PM",
            }),
        /24-hour HH:MM/,
    );
});
