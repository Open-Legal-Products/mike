"use client";

export function DataRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-xs">
            <span className="text-gray-400">{label}</span>
            <span className="truncate text-gray-800">{value}</span>
        </div>
    );
}
