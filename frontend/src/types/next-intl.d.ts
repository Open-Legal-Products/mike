import type { Locale } from "@/i18n/config";

/**
 * Type augmentation for next-intl. Binds the message catalog and locale union
 * to the library so `useTranslations`, `getTranslations`, and `useLocale` are
 * type-checked against `messages/en.json` keys. A `t("...")` call referencing a
 * missing key becomes a compile-time error.
 */
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof import("../../messages/en.json");
    }
}
