import Link from "next/link";
import { BoMark } from "@/app/components/chat/bo-mark";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    iconClassName?: string;
    animate?: boolean;
    asLink?: boolean;
}

export function SiteLogo({
    size = "md",
    className = "",
    iconClassName = "",
    animate = false,
    asLink = false,
}: SiteLogoProps) {
    const sizeClasses = {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-6xl",
    };

    // Mark height aligns with the serif wordmark cap height at each size.
    const iconSizes = {
        sm: 22,
        md: 26,
        lg: 36,
        xl: 56,
    };

    const logo = (
        <h1
            className={`flex items-center gap-2 ${sizeClasses[size]} font-light font-serif leading-none ${
                animate ? "sidebar-fade-in" : ""
            } ${className}`}
        >
            <span
                className={`inline-flex shrink-0 items-center leading-none ${iconClassName}`}
            >
                <BoMark size={iconSizes[size]} />
            </span>
            <span>Bo</span>
        </h1>
    );

    if (asLink) {
        return (
            <Link
                href="/"
                className="cursor-pointer hover:opacity-80 transition-opacity"
            >
                {logo}
            </Link>
        );
    }

    return logo;
}
