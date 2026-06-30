"use client";

export function VersionUploadSkeleton() {
    return (
        <div className="rounded-lg border border-white/70 bg-white px-3 py-2 shadow-[0_1px_4px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="animate-pulse space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="h-3 w-20 rounded-full bg-gray-200" />
                    <div className="h-3 w-9 rounded-full bg-blue-100" />
                </div>
                <div className="h-2.5 w-4/5 rounded-full bg-gray-200" />
                <div className="h-2.5 w-2/5 rounded-full bg-gray-200" />
            </div>
        </div>
    );
}
