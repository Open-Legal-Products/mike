import type { Metadata } from "next";
import { Inter, EB_Garamond } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/components/providers";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
    variable: "--font-eb-garamond",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://app.mikeoss.com"),
    description:
        "AI 驱动的法律文档分析与合同审查平台。",
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
        siteName: "我的律师合伙人",
        title: "我的律师合伙人 - AI 法律平台",
        description:
            "AI 驱动的法律文档分析与合同审查平台。",
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 651,
                alt: "我的律师合伙人",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "我的律师合伙人 - AI 法律平台",
        description:
            "AI 驱动的法律文档分析与合同审查平台。",
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN">
            <body
                className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
