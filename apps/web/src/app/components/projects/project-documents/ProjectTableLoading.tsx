import { DOC_NAME_COL_W } from "../ProjectPageParts";

/**
 * Skeleton placeholder for the documents table shown while the project loads.
 * Mirrors the real table header + a handful of shimmer rows.
 */
export function ProjectTableLoading({
    stickyCellBg,
}: {
    stickyCellBg: string;
}) {
    return (
        <div className="flex-1 flex flex-col min-h-0">
            <div className={`sticky top-0 z-[70] ${stickyCellBg} flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none shrink-0`}>
                <div
                    className={`sticky left-0 z-[80] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
                >
                    <div className="h-2.5 w-2.5 rounded bg-gray-100 animate-pulse" />
                    <span>Name</span>
                </div>
                <div className="ml-auto w-20 shrink-0 text-left">Type</div>
                <div className="w-24 shrink-0 text-left">Size</div>
                <div className="w-20 shrink-0 text-left">Version</div>
                <div className="w-32 shrink-0 text-left">Created</div>
                <div className="w-32 shrink-0 text-left">Updated</div>
                <div className="w-8 shrink-0" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
                <div
                    key={i}
                    className="flex items-center h-10 pr-8 border-b border-gray-50"
                >
                    <div
                        className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    >
                        <div className="flex items-center gap-4">
                            <div className="h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse" />
                            <div
                                className="h-3.5 rounded bg-gray-100 animate-pulse"
                                style={{ width: `${210 + i * 16}px` }}
                            />
                        </div>
                    </div>
                    <div className="ml-auto w-20 shrink-0">
                        <div className="h-3 w-8 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-24 shrink-0">
                        <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-20 shrink-0">
                        <div className="h-3 w-5 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-32 shrink-0">
                        <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-32 shrink-0">
                        <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-8 shrink-0" />
                </div>
            ))}
        </div>
    );
}
