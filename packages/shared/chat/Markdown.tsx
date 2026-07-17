import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/utils";

/**
 * Shared markdown renderer for chat content. A trimmed, dependency-light
 * version of the web assistant's renderer (react-markdown + remark-gfm)
 * with explicit element styling so it looks identical without depending on
 * a Tailwind typography plugin. Used by assistant message bubbles in both
 * the web app and the Word add-in.
 */
export function Markdown({
    children,
    className,
}: {
    children: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "text-sm leading-relaxed text-gray-900 break-words",
                className
            )}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => (
                        <p className="mb-3 last:mb-0 whitespace-pre-wrap">
                            {children}
                        </p>
                    ),
                    h1: ({ children }) => (
                        <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
                            {children}
                        </h3>
                    ),
                    ul: ({ children }) => (
                        <ul className="mb-3 list-disc pl-5 space-y-1 last:mb-0">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="mb-3 list-decimal pl-5 space-y-1 last:mb-0">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => <li className="pl-0.5">{children}</li>,
                    a: ({ children, href }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
                        >
                            {children}
                        </a>
                    ),
                    strong: ({ children }) => (
                        <strong className="font-semibold">{children}</strong>
                    ),
                    em: ({ children }) => <em className="italic">{children}</em>,
                    blockquote: ({ children }) => (
                        <blockquote className="mb-3 border-l-2 border-gray-300 pl-3 text-gray-600 italic last:mb-0">
                            {children}
                        </blockquote>
                    ),
                    code: ({ className: codeClass, children }) => {
                        const isBlock = (codeClass ?? "").includes("language-");
                        if (isBlock) {
                            return (
                                <code className="block overflow-x-auto rounded-md bg-gray-100 p-3 font-mono text-xs text-gray-800">
                                    {children}
                                </code>
                            );
                        }
                        return (
                            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-800">
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => (
                        <pre className="mb-3 last:mb-0">{children}</pre>
                    ),
                    table: ({ children }) => (
                        <div className="mb-3 overflow-x-auto last:mb-0">
                            <table className="w-full border-collapse text-xs">
                                {children}
                            </table>
                        </div>
                    ),
                    th: ({ children }) => (
                        <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="border border-gray-200 px-2 py-1">
                            {children}
                        </td>
                    ),
                    hr: () => <hr className="my-3 border-gray-200" />,
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}
