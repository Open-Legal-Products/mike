import crypto from "node:crypto";

export type OntarioProcedureSource = {
    id: string;
    kind: "rule" | "practice-direction" | "form-catalogue";
    title: string;
    jurisdiction: "CA-ON";
    court: string;
    scope: "provincewide" | "regional";
    region: string | null;
    language: "en" | "fr" | "bilingual";
    citation: string | null;
    officialUrl: string;
    updateCadence: "daily" | "weekly";
    lastReviewedDate: string;
    copyingPolicy: "link-only" | "official-text-adapter";
};

export type OntarioCourtForm = {
    number: string;
    title: string;
    court: string;
    language: "en" | "fr" | "bilingual";
    officialCatalogueUrl: string;
    revisionDate: string | null;
    status: "check-official-current-version";
};

export const ONTARIO_PROCEDURE_SOURCES: OntarioProcedureSource[] = [
    {
        id: "ontario-rules-civil-procedure",
        kind: "rule",
        title: "Rules of Civil Procedure",
        jurisdiction: "CA-ON",
        court: "Ontario Superior Court of Justice and Court of Appeal for Ontario",
        scope: "provincewide",
        region: null,
        language: "bilingual",
        citation: "R.R.O. 1990, Reg. 194",
        officialUrl: "https://www.ontario.ca/laws/regulation/900194",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "official-text-adapter",
    },
    {
        id: "ontario-rules-small-claims",
        kind: "rule",
        title: "Rules of the Small Claims Court",
        jurisdiction: "CA-ON",
        court: "Ontario Small Claims Court",
        scope: "provincewide",
        region: null,
        language: "bilingual",
        citation: "O. Reg. 258/98",
        officialUrl: "https://www.ontario.ca/laws/regulation/980258",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "official-text-adapter",
    },
    {
        id: "ontario-scj-practice-directions",
        kind: "practice-direction",
        title: "Superior Court of Justice Practice Directions",
        jurisdiction: "CA-ON",
        court: "Ontario Superior Court of Justice",
        scope: "regional",
        region: "User must identify the applicable one of eight regions",
        language: "en",
        citation: null,
        officialUrl: "https://www.ontariocourts.ca/scj/practice-directions/",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "link-only",
    },
    {
        id: "ontario-coa-general-practice-direction",
        kind: "practice-direction",
        title: "General Practice Direction Regarding All Proceedings in the Court of Appeal",
        jurisdiction: "CA-ON",
        court: "Court of Appeal for Ontario",
        scope: "provincewide",
        region: null,
        language: "en",
        citation: null,
        officialUrl:
            "https://www.ontariocourts.ca/coa/how-to-proceed-court/general/",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "link-only",
    },
    {
        id: "ontario-scj-civil-forms",
        kind: "form-catalogue",
        title: "Rules of Civil Procedure Forms",
        jurisdiction: "CA-ON",
        court: "Ontario Superior Court of Justice",
        scope: "provincewide",
        region: null,
        language: "bilingual",
        citation: null,
        officialUrl:
            "https://www.ontariocourts.ca/scj/filing-procedures/rules/civil/",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "link-only",
    },
    {
        id: "ontario-small-claims-forms",
        kind: "form-catalogue",
        title: "Rules of the Small Claims Court Forms",
        jurisdiction: "CA-ON",
        court: "Ontario Small Claims Court",
        scope: "provincewide",
        region: null,
        language: "bilingual",
        citation: null,
        officialUrl:
            "https://www.ontariocourts.ca/scj/filing-procedures/rules/small-claims/",
        updateCadence: "daily",
        lastReviewedDate: "2026-07-16",
        copyingPolicy: "link-only",
    },
];

export const ONTARIO_COURT_FORMS: OntarioCourtForm[] = [
    form(
        "14A",
        "Statement of Claim",
        "Ontario Superior Court of Justice",
        "civil",
    ),
    form(
        "18A",
        "Notice of Intent to Defend",
        "Ontario Superior Court of Justice",
        "civil",
    ),
    form(
        "7A",
        "Plaintiff's Claim",
        "Ontario Small Claims Court",
        "small-claims",
    ),
    form(
        "8A",
        "Affidavit of Service",
        "Ontario Small Claims Court",
        "small-claims",
    ),
    form("9A", "Defence", "Ontario Small Claims Court", "small-claims"),
    form(
        "10A",
        "Defendant's Claim",
        "Ontario Small Claims Court",
        "small-claims",
    ),
];

function form(
    number: string,
    title: string,
    court: string,
    catalogue: "civil" | "small-claims",
): OntarioCourtForm {
    return {
        number,
        title,
        court,
        language: "bilingual",
        officialCatalogueUrl: `https://www.ontariocourts.ca/scj/filing-procedures/rules/${catalogue}/`,
        revisionDate: null,
        status: "check-official-current-version",
    };
}

export async function checkOntarioProcedureSources(
    fetchImpl: typeof fetch = fetch,
) {
    return Promise.all(
        ONTARIO_PROCEDURE_SOURCES.map(async (source) => {
            const url = new URL(source.officialUrl);
            if (
                !["www.ontario.ca", "www.ontariocourts.ca"].includes(
                    url.hostname,
                )
            )
                throw new Error("Procedure source host is not allowlisted.");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);
            try {
                const response = await fetchImpl(url, {
                    method: "HEAD",
                    redirect: "error",
                    signal: controller.signal,
                });
                return {
                    sourceId: source.id,
                    ok: response.ok,
                    checkedAt: new Date().toISOString(),
                    etag: response.headers.get("etag"),
                    lastModified: response.headers.get("last-modified"),
                    metadataHash: crypto
                        .createHash("sha256")
                        .update(
                            JSON.stringify({
                                url: source.officialUrl,
                                etag: response.headers.get("etag"),
                                lastModified:
                                    response.headers.get("last-modified"),
                            }),
                        )
                        .digest("hex"),
                };
            } finally {
                clearTimeout(timer);
            }
        }),
    );
}

export type OntarioDeadlineInput = {
    profile: "ontario-civil-rule-3" | "ontario-small-claims-rule-3";
    triggerDate: string;
    days: number;
    serviceLocalTime?: string;
    originatingProcess?: boolean;
    additionalHolidays?: string[];
    courtClosures?: string[];
    calculationTimestamp?: string;
};

export type OntarioDeadlineResult = {
    dueDate: string;
    adjustedTriggerDate: string;
    countedDates: string[];
    excludedDates: Array<{ date: string; reason: string }>;
    assumptions: string[];
    warnings: string[];
    governingRule: string;
    governingRuleUrl: string;
    timeZone: "America/Toronto";
    calculatedAt: string;
    requiresUserConfirmation: true;
};

export function calculateOntarioDeadline(
    input: OntarioDeadlineInput,
): OntarioDeadlineResult {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.triggerDate))
        throw new Error("triggerDate must use YYYY-MM-DD.");
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 366)
        throw new Error("days must be an integer from 1 to 366.");
    if (
        input.serviceLocalTime !== undefined &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.serviceLocalTime)
    )
        throw new Error("serviceLocalTime must use 24-hour HH:MM format.");
    for (const value of [
        ...(input.additionalHolidays ?? []),
        ...(input.courtClosures ?? []),
    ])
        parseDate(value);
    const trigger = parseDate(input.triggerDate);
    const extra = new Set(input.additionalHolidays ?? []);
    const closures = new Set(input.courtClosures ?? []);
    const isHoliday = (date: Date) =>
        isOntarioCourtHoliday(date) ||
        extra.has(formatDate(date)) ||
        closures.has(formatDate(date));
    const excludedDates: OntarioDeadlineResult["excludedDates"] = [];
    let adjustedTrigger = trigger;
    const isCivil = input.profile === "ontario-civil-rule-3";
    const servedAfterFour =
        isCivil &&
        !input.originatingProcess &&
        typeof input.serviceLocalTime === "string" &&
        input.serviceLocalTime >= "16:00";
    if (isCivil && (servedAfterFour || isHoliday(adjustedTrigger))) {
        do {
            adjustedTrigger = addDays(adjustedTrigger, 1);
        } while (isHoliday(adjustedTrigger));
    }

    const countedDates: string[] = [];
    let cursor = adjustedTrigger;
    while (countedDates.length < input.days) {
        cursor = addDays(cursor, 1);
        if (isCivil && input.days <= 7 && isHoliday(cursor)) {
            excludedDates.push({
                date: formatDate(cursor),
                reason: holidayReason(cursor, extra, closures),
            });
            continue;
        }
        countedDates.push(formatDate(cursor));
    }
    while (isHoliday(cursor)) {
        excludedDates.push({
            date: formatDate(cursor),
            reason: `Due date moved: ${holidayReason(cursor, extra, closures)}`,
        });
        cursor = addDays(cursor, 1);
    }

    const civilRule = "R.R.O. 1990, Reg. 194, r. 3.01";
    const smallClaimsRule = "O. Reg. 258/98, r. 3.01";
    return {
        dueDate: formatDate(cursor),
        adjustedTriggerDate: formatDate(adjustedTrigger),
        countedDates,
        excludedDates,
        assumptions: [
            "The first day is excluded and the last day is included.",
            isCivil && input.days <= 7
                ? "Because the prescribed period is seven days or less, holidays are not counted."
                : "Intermediate holidays are counted; a holiday due date moves to the next non-holiday.",
            "Local time is America/Toronto.",
            ...(servedAfterFour
                ? [
                      "Non-originating service after 4:00 p.m. is deemed made on the next non-holiday.",
                  ]
                : []),
            ...(input.originatingProcess
                ? [
                      "The after-4:00 p.m. deemed-service rule was not applied to an originating process.",
                  ]
                : []),
        ],
        warnings: [
            "Confirm the governing rule, triggering event, service method, local court notices, extensions, orders, and agreements.",
            "Special proclaimed holidays and unexpected court closures are included only when supplied in additionalHolidays or courtClosures.",
            "This procedural calculation is not a substantive limitation-period opinion.",
        ],
        governingRule: isCivil ? civilRule : smallClaimsRule,
        governingRuleUrl: isCivil
            ? "https://www.ontario.ca/laws/regulation/900194#BK60"
            : "https://www.ontario.ca/laws/regulation/980258#BK8",
        timeZone: "America/Toronto",
        calculatedAt: input.calculationTimestamp ?? new Date().toISOString(),
        requiresUserConfirmation: true,
    };
}

function parseDate(value: string) {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime()) || formatDate(date) !== value)
        throw new Error("triggerDate is not a valid calendar date.");
    return date;
}

function formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + amount);
    return next;
}

function isOntarioCourtHoliday(date: Date) {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return true;
    const year = date.getUTCFullYear();
    return ontarioFixedHolidays(year).has(formatDate(date));
}

function ontarioFixedHolidays(year: number) {
    const dates = new Set<string>();
    const add = (date: Date) => dates.add(formatDate(date));
    const addObservedMonday = (month: number, day: number) => {
        const date = new Date(Date.UTC(year, month, day, 12));
        add(date);
        if (date.getUTCDay() === 6) add(addDays(date, 2));
        if (date.getUTCDay() === 0) add(addDays(date, 1));
    };
    addObservedMonday(0, 1);
    add(nthWeekday(year, 1, 1, 3));
    const easter = easterSunday(year);
    add(addDays(easter, -2));
    add(addDays(easter, 1));
    add(lastWeekdayOnOrBefore(year, 4, 24, 1));
    addObservedMonday(6, 1);
    add(nthWeekday(year, 7, 1, 1));
    add(nthWeekday(year, 8, 1, 1));
    add(nthWeekday(year, 9, 1, 2));
    addObservedMonday(10, 11);
    const christmas = new Date(Date.UTC(year, 11, 25, 12));
    const boxing = new Date(Date.UTC(year, 11, 26, 12));
    add(christmas);
    add(boxing);
    if (christmas.getUTCDay() === 5) add(addDays(christmas, 3));
    if (christmas.getUTCDay() === 6) {
        add(addDays(christmas, 2));
        add(addDays(christmas, 3));
    }
    if (christmas.getUTCDay() === 0) {
        add(addDays(christmas, 1));
        add(addDays(christmas, 2));
    }
    return dates;
}

function nthWeekday(
    year: number,
    month: number,
    weekday: number,
    occurrence: number,
) {
    const date = new Date(Date.UTC(year, month, 1, 12));
    const offset = (weekday - date.getUTCDay() + 7) % 7;
    date.setUTCDate(1 + offset + (occurrence - 1) * 7);
    return date;
}

function lastWeekdayOnOrBefore(
    year: number,
    month: number,
    day: number,
    weekday: number,
) {
    const date = new Date(Date.UTC(year, month, day, 12));
    date.setUTCDate(day - ((date.getUTCDay() - weekday + 7) % 7));
    return date;
}

function easterSunday(year: number) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month, day, 12));
}

function holidayReason(date: Date, extra: Set<string>, closures: Set<string>) {
    const value = formatDate(date);
    if (closures.has(value)) return "User-supplied court closure";
    if (extra.has(value)) return "User-supplied additional holiday";
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) return "Weekend";
    return "Ontario court holiday";
}
