"use client";

export function DocReadBlock({
    label,
    isStreaming,
}: {
    label: string;
    isStreaming?: boolean;
}) {
    return (
        <div className="flex items-center text-sm text-gray-400 ml-1">
            {isStreaming ? (
                <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <span className="font-medium ml-2">
                {isStreaming ? "Reading" : "Read"}
            </span>
            <span className="ml-1 text-gray-500">{label}</span>
        </div>
    );
}
