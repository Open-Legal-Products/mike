/**
 * Central i18n configuration.
 *
 * To add a new language:
 *   1. Add its code to `locales` and a label to `localeLabels`.
 *   2. Drop a matching `messages/<locale>.json` file (same shape as `en.json`).
 * Everything else (request config, language switcher, cookie handling) reads
 * from here, so no other wiring is required.
 */
export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that stores the user's selected locale (read in `i18n/request.ts`). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Human-readable names shown in the language switcher. */
export const localeLabels: Record<Locale, string> = {
    en: "English",
};

export function isLocale(value: string | undefined | null): value is Locale {
    return value != null && (locales as readonly string[]).includes(value);
}
