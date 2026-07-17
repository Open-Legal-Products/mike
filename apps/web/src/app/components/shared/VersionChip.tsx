/**
 * Small "V3" badge for document rows/listings, rendered when the doc has
 * at least one assistant-edit version. Matches the chip in the side
 * panel's edit-tab header.
 */
export function VersionChip({ n }: { n: number | null | undefined }) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
    return (
        <span className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-1 py-0.5 text-[10px] font-medium text-gray-500">
            V{n}
        </span>
    );
}
