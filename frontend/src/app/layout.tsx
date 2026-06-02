import type { Metadata } from "next";
import { Inter, EB_Garamond } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
    variable: "--font-eb-garamond",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    const title = t("title");
    const description = t("description");

    return {
        metadataBase: new URL("https://app.mikeoss.com"),
        title,
        description,
        icons: {
            icon: [
                { url: "/icon.svg", type: "image/svg+xml" },
                { url: "/favicon.ico" },
            ],
            apple: "/apple-touch-icon.png",
        },
        openGraph: {
            type: "website",
            url: "https://app.mikeoss.com",
            siteName: "Mike",
            title,
            description,
            images: [
                {
                    url: "/link-image.jpg",
                    width: 1200,
                    height: 651,
                    alt: "Mike",
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: ["/link-image.jpg"],
        },
    };
}

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();

    return (
        <html lang={locale}>
            <body
                className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}
            >
                <NextIntlClientProvider>
                    <Providers>{children}</Providers>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
