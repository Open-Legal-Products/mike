/** Aspect ratio of the isometric Bo mark (viewBox 99×140). */
export const BO_MARK_ASPECT = 99 / 140;

export type BoMarkVariant = "auto" | "dark" | "light";

type BoMarkProps = {
    /** Rendered height in px; width follows the mark aspect ratio. */
    size?: number;
    className?: string;
    title?: string;
    /**
     * Color variant of the static mark asset.
     * - `dark` — near-black mark for light surfaces (default asset)
     * - `light` — near-white mark for dark surfaces
     * - `auto` — dark on light; switches to light mark under `.dark`
     */
    variant?: BoMarkVariant;
};

/**
 * Isometric architectural block mark for Bo.
 * Geometry is solid fill — lit faces read as negative space on the surface.
 */
export function BoMark({
    size = 24,
    className = "",
    title = "Bo",
    variant = "auto",
}: BoMarkProps) {
    const height = size;
    const width = Math.round(size * BO_MARK_ASPECT * 10) / 10;

    if (variant === "auto") {
        return (
            <span
                className={`relative inline-block shrink-0 ${className}`}
                style={{ width, height }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG mark */}
                <img
                    src="/bo-mark.svg"
                    alt={title}
                    width={width}
                    height={height}
                    className="block dark:hidden"
                    draggable={false}
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- static public SVG mark */}
                <img
                    src="/bo-mark-light.svg"
                    alt=""
                    width={width}
                    height={height}
                    className="hidden dark:block"
                    draggable={false}
                    aria-hidden="true"
                />
            </span>
        );
    }

    const src = variant === "light" ? "/bo-mark-light.svg" : "/bo-mark.svg";

    return (
        // eslint-disable-next-line @next/next/no-img-element -- static public SVG mark
        <img
            src={src}
            alt={title}
            width={width}
            height={height}
            className={`shrink-0 block ${className}`}
            draggable={false}
        />
    );
}
