import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Resolves the active locale per request from the `NEXT_LOCALE` cookie and
 * loads the matching message catalog. Falls back to the default locale when no
 * (valid) cookie is present. Wired into Next.js via `createNextIntlPlugin` in
 * `next.config.ts`.
 */
export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    const locale: Locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default,
    };
});
