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
    title: "Bo — Construction Intelligence",
    description: "Upload the job. Ask Bo. Verify the source.",
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
        siteName: "Bo",
        title: "Bo — Construction Intelligence",
        description: "Upload the job. Ask Bo. Verify the source.",
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 630,
                alt: "Bo",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "Bo — Construction Intelligence",
        description: "Upload the job. Ask Bo. Verify the source.",
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body
                className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
