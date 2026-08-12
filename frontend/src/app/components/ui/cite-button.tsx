import React, { useState } from "react";
import { Check } from "lucide-react";
import { QuoteIcon } from "@radix-ui/react-icons";

interface CiteButtonProps {
    quoteText: string;
    citationText: string;
    className?: string;
    showText?: boolean;
    iconSize?: number;
    textClassName?: string;
}

export function CiteButton({
    quoteText,
    citationText,
    className = "",
    showText = true,
    iconSize = 12,
    textClassName = "text-[10px] font-medium",
}: CiteButtonProps) {
    const [isCopied, setIsCopied] = useState(false);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        try {
            const compiledText =
                `"${quoteText.replace(/"/g, "'")}" ${citationText}`.trim();
            await navigator.clipboard.writeText(compiledText);

            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy citation:", err);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`transition-colors flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 ${className}`}
            title="Copy Quote and Citation"
            // Only label it when there is no visible text: an icon-only button
            // would otherwise have no accessible name (WCAG 4.1.2), while
            // overriding the visible "Cite" would break label-in-name (2.5.3).
            aria-label={
                showText
                    ? undefined
                    : isCopied
                      ? "Citation copied"
                      : "Copy quote and citation"
            }
        >
            {isCopied ? (
                <Check
                    style={{ width: iconSize, height: iconSize }}
                    className="text-green-600"
                />
            ) : (
                <QuoteIcon style={{ width: iconSize, height: iconSize }} />
            )}
            {showText && (
                <span
                    className={
                        isCopied
                            ? `text-green-600 ${textClassName}`
                            : textClassName
                    }
                >
                    {isCopied ? "Copied" : "Cite"}
                </span>
            )}
        </button>
    );
}
