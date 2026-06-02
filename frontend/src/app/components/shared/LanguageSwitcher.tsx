"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Globe } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/i18n/actions";
import { locales, localeLabels, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Lets the user switch the UI language. Persists the choice via the `setLocale`
 * server action (writes the `NEXT_LOCALE` cookie) and refreshes the router so
 * server components re-render in the new locale.
 */
export function LanguageSwitcher() {
    const t = useTranslations("LanguageSwitcher");
    const activeLocale = useLocale() as Locale;
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleSelect = (next: string) => {
        if (next === activeLocale) return;
        startTransition(async () => {
            await setLocale(next as Locale);
            router.refresh();
        });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                disabled={isPending}
                aria-label={t("label")}
                className={cn(
                    "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                )}
            >
                <Globe className="h-4 w-4 text-gray-500" />
                {localeLabels[activeLocale]}
                <ChevronDown className="h-4 w-4 text-gray-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[10rem]">
                <DropdownMenuRadioGroup
                    value={activeLocale}
                    onValueChange={handleSelect}
                >
                    {locales.map((locale) => (
                        <DropdownMenuRadioItem key={locale} value={locale}>
                            <span className="flex-1">
                                {localeLabels[locale]}
                            </span>
                            {locale === activeLocale && (
                                <Check className="h-4 w-4 text-gray-600" />
                            )}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
