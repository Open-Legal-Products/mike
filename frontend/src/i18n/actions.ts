"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./config";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persists the user's locale choice in the `NEXT_LOCALE` cookie. The next
 * request is then resolved by `i18n/request.ts`. Callers should refresh the
 * router afterwards so server components re-render with the new locale.
 */
export async function setLocale(locale: Locale): Promise<void> {
    if (!isLocale(locale)) return;

    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, locale, {
        maxAge: ONE_YEAR_IN_SECONDS,
        path: "/",
        sameSite: "lax",
    });
}
